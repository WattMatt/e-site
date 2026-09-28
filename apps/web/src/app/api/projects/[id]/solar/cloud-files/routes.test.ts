// apps/web/src/app/api/projects/[id]/solar/cloud-files/routes.test.ts
// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

const h = vi.hoisted(() => ({ gate: vi.fn(), list: vi.fn(), download: vi.fn(), upload: vi.fn(), fake: { current: null as unknown }, project: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.project.current }) }) }) }) }),
    storage: { from: () => ({ upload: h.upload }) },
  }),
}))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => h.gate(...a) }))
vi.mock('@/services/cloud-storage-folder.server', () => ({ listCloudFolder: h.list, downloadCloudFile: h.download }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (h.fake.current as { repo: unknown }).repo }
})

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { GET } from './route'
import { POST } from './import/route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const ctx = { params: Promise.resolve({ id: P }) }
const bytes = new TextEncoder().encode('date,p14\n')
const sha = createHash('sha256').update(bytes).digest('hex')

beforeEach(() => {
  vi.clearAllMocks()
  h.gate.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  h.project.current = { organisation_id: ORG, cloud_storage_connection_id: 'conn-1', cloud_storage_folder_id: 'root', cloud_storage_folder_path: '/Meters' }
  h.fake.current = createFakeRepo({ orgByProject: { [P]: ORG } })
  h.upload.mockResolvedValue({ error: null })
})

describe('GET cloud-files', () => {
  it('lists folders and meter files only, from the mapped folder by default', async () => {
    h.list.mockResolvedValue({ items: [
      { id: 'd', name: 'Sub', type: 'folder' }, { id: 'a', name: 'a.CSV', type: 'file', size: 10 },
      { id: 'b', name: 'b.pdf', type: 'file', size: 10 }, { id: 'c', name: 'c.xlsx', type: 'file', size: 60 * 1024 * 1024 },
    ] })
    const body = await (await GET(new Request('http://x/cloud-files'), ctx)).json()
    expect(h.list).toHaveBeenCalledWith({ connectionId: 'conn-1', folderId: 'root', pageToken: undefined }, expect.anything())
    expect(body.items.map((i: { id: string }) => i.id)).toEqual(['d', 'a'])
    expect(body.rootPath).toBe('/Meters')
  })
  it('lists a sub-folder only when its trail from the mapped root is proven by listing each parent', async () => {
    const tree: Record<string, Array<{ id: string; name: string; type: 'file' | 'folder' }>> = {
      root: [{ id: 'd', name: 'Sub', type: 'folder' }],
      d: [{ id: 'e', name: 'Deeper', type: 'folder' }],
      e: [{ id: 'z', name: 'z.csv', type: 'file' }],
    }
    h.list.mockImplementation(async ({ folderId }: { folderId: string }) => ({ items: tree[folderId] ?? [] }))
    const res = await GET(new Request('http://x/cloud-files?trail=d&trail=e'), ctx)
    expect(res.status).toBe(200)
    expect((await res.json()).items.map((i: { id: string }) => i.id)).toEqual(['z'])
  })
  it('403 with a sentence for a folder outside the mapped root (a bare id, or a trail that does not hold)', async () => {
    h.list.mockImplementation(async ({ folderId }: { folderId: string }) => ({ items: folderId === 'root' ? [{ id: 'd', name: 'Sub', type: 'folder' }] : [{ id: 'secret.csv', name: 'secret.csv', type: 'file' }] }))
    for (const q of ['?folderId=id:elsewhere', '?trail=id:elsewhere', '?trail=d&trail=id:elsewhere', '?folderId=id:elsewhere&trail=d']) {
      const res = await GET(new Request(`http://x/cloud-files${q}`), ctx)
      expect(res.status, q).toBe(403)
      expect(await res.json(), q).toEqual({ error: 'outside_mapped_folder', message: "That folder is outside this project's mapped cloud folder." })
    }
    expect(h.list).not.toHaveBeenCalledWith(expect.objectContaining({ folderId: 'id:elsewhere' }), expect.anything())
  })
  it('404 no_mapping when the project has no cloud folder', async () => {
    h.project.current = { organisation_id: ORG, cloud_storage_connection_id: null, cloud_storage_folder_id: null }
    expect((await GET(new Request('http://x/cloud-files'), ctx)).status).toBe(404)
  })
})

describe('POST cloud-files/import', () => {
  beforeEach(() => {
    h.list.mockImplementation(async ({ folderId }: { folderId: string }) => ({
      items: folderId === 'root'
        ? [{ id: 'a', name: 'a.csv', type: 'file' }, { id: 'x', name: 'x.pdf', type: 'file' }, { id: 'y', name: 'y.csv', type: 'file' }, { id: 'd', name: 'Sub', type: 'folder' }]
        : folderId === 'd' ? [{ id: 's', name: 's.xlsx', type: 'file' }] : [],
    }))
  })
  it('refuses a file that is not a child of the mapped root (or of the trail it claims)', async () => {
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'id:elsewhere', name: 'e.csv' }, { id: 's', name: 's.xlsx' }, { id: 's', name: 's.xlsx', trail: ['id:other'] }] }) }), ctx)).json()
    expect(body.results).toEqual([
      { name: 'e.csv', error: 'outside_mapped_folder' },
      { name: 's.xlsx', error: 'outside_mapped_folder' },
      { name: 's.xlsx', error: 'outside_mapped_folder' },
    ])
    expect(h.download).not.toHaveBeenCalled()
  })
  it('imports a file in a sub-folder when its trail holds', async () => {
    h.download.mockResolvedValue({ bytes, filename: 's.xlsx' })
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 's', name: 's.xlsx', trail: ['d'] }] }) }), ctx)).json()
    expect(body.results[0].fileId).toBeTruthy()
  })
  it('the extension comes from the provider, never the client: a "csv" that is really a pdf is refused', async () => {
    h.download.mockResolvedValue({ bytes, filename: 'x.pdf' })
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'x', name: 'x.csv' }] }) }), ctx)).json()
    expect(body.results).toEqual([{ name: 'x.csv', error: 'not_a_meter_file' }])
    // Listed as a csv, downloaded as a pdf (renamed between list and download): still refused, nothing stored.
    h.download.mockResolvedValue({ bytes, filename: 'a.pdf' })
    const again = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', name: 'a.csv' }] }) }), ctx)).json()
    expect(again.results).toEqual([{ name: 'a.csv', error: 'not_a_meter_file' }])
    expect(h.upload).not.toHaveBeenCalled()
  })
  it('copies the bytes to <org>/<project>/<sha>.<ext> and registers them', async () => {
    h.download.mockResolvedValue({ bytes, filename: 'a.csv' })
    const res = await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', name: 'a.csv' }] }) }), ctx)
    const body = await res.json()
    expect(h.upload).toHaveBeenCalledWith(`${ORG}/${P}/${sha}.csv`, bytes, { contentType: 'text/csv', upsert: false })
    expect(body.results[0]).toMatchObject({ name: 'a.csv', duplicate: false })
    expect(body.results[0].fileId).toBeTruthy()
  })
  it('treats an already-stored object as fine (same bytes by construction)', async () => {
    h.download.mockResolvedValue({ bytes, filename: 'a.csv' })
    h.upload.mockResolvedValue({ error: { message: 'The resource already exists', statusCode: '409' } })
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'a', name: 'a.csv' }] }) }), ctx)).json()
    expect(body.results[0].fileId).toBeTruthy()
  })
  it('refuses a disallowed extension and an oversized file per item', async () => {
    h.download.mockRejectedValue(new Error('too_large'))
    const body = await (await POST(new Request('http://x', { method: 'POST', body: JSON.stringify({ items: [{ id: 'x', name: 'x.pdf' }, { id: 'y', name: 'y.csv' }] }) }), ctx)).json()
    expect(body.results).toEqual([{ name: 'x.pdf', error: 'not_a_meter_file' }, { name: 'y.csv', error: 'file_too_large' }])
  })
})
