// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { gateMock, fake } = vi.hoisted(() => ({ gateMock: vi.fn(), fake: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (fake.current as { repo: unknown }).repo }
})

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const F1 = '3b241101-e2bb-4255-8caf-4136c566a962'
const A = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\n10/03/2025 01:00:00,3\r\n')
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({
    orgByProject: { [P]: ORG }, raw: { a: A },
    files: [{ id: F1, organisation_id: ORG, project_id: P, sha256: 'a'.repeat(64), size_bytes: A.byteLength, storage_path: 'a', original_name: 'SITE A, 1, T, 10.csv', status: 'parsed' }],
  })
})

describe('POST …/meter-files/commit', () => {
  it('400 for an invalid body', async () => {
    expect((await call({ mode: 'series', fileId: F1 })).status).toBe(400)
  })
  it('404 for a file of another project', async () => {
    ;(fake.current as ReturnType<typeof createFakeRepo>).state.files[0].project_id = '11111111-1111-4111-8111-111111111111'
    expect((await call({ mode: 'skip', fileId: F1, reason: 'not ours' })).status).toBe(404)
  })
  it('200 on a clean series commit', async () => {
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'tenant' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(200)
    expect(await r.json()).toMatchObject({ channels: [{ sourceColumn: 'p14', readings: 3 }] })
  })
  it('maps CommitError to its status and body', async () => {
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'water' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'water_is_not_load' })
  })
})
