// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { createHash } from 'node:crypto'

const { gateMock, fake } = vi.hoisted(() => ({ gateMock: vi.fn(), fake: { current: null as unknown } }))
vi.mock('@/lib/supabase/server', () => ({ createClient: async () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: (...a: unknown[]) => gateMock(...a) }))
vi.mock('@/lib/solar/meter-import/repo', async () => {
  const actual = await vi.importActual<typeof import('@/lib/solar/meter-import/repo')>('@/lib/solar/meter-import/repo')
  return { ...actual, createMeterImportRepo: () => (fake.current as { repo: unknown }).repo }
})

import { NextResponse } from 'next/server'
import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const bytes = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n')
const sha = createHash('sha256').update(bytes).digest('hex')
const path = `${ORG}/${P}/${sha}.csv`
const call = (b: unknown, id = P) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({ orgByProject: { [P]: ORG }, raw: { [path]: bytes } })
})

describe('POST /api/projects/[id]/solar/meter-files', () => {
  it('400 on a non-UUID project id', async () => {
    expect((await call({}, 'nope')).status).toBe(400)
  })
  it('passes the gate response through (403) and needs Edit', async () => {
    gateMock.mockResolvedValue({ ok: false, response: NextResponse.json({ error: 'Solar access required' }, { status: 403 }) })
    expect((await call({ storagePath: path, originalName: 'a.csv' })).status).toBe(403)
    expect(gateMock).toHaveBeenCalledWith({}, P, 'edit')
  })
  it('400 when the path is not <org>/<project>/<sha>.<ext> of THIS project', async () => {
    expect((await call({ storagePath: `${ORG}/${ORG}/${sha}.csv`, originalName: 'a.csv' })).status).toBe(400)
    expect((await call({ storagePath: 'x.csv', originalName: 'a.csv' })).status).toBe(400)
  })
  it.each([
    ['another org', `11111111-1111-4111-8111-111111111111/${P}/${sha}.csv`],
    ['a parent-directory segment', `${ORG}/${P}/../${P}/${sha}.csv`],
    ['an extra segment', `${ORG}/${P}/x/${sha}.csv`],
    ['a leading slash', `/${ORG}/${P}/${sha}.csv`],
    ['a disallowed extension', `${ORG}/${P}/${sha}.exe`],
    ['an upper-case sha', `${ORG}/${P}/${sha.toUpperCase()}.csv`],
  ])('400 and no download for %s', async (_label, storagePath) => {
    const f = fake.current as ReturnType<typeof createFakeRepo>
    f.state.raw[storagePath] = bytes
    let downloads = 0
    const orig = f.repo.downloadRaw
    f.repo.downloadRaw = async (p) => { downloads++; return orig(p) }
    expect((await call({ storagePath, originalName: 'a.csv' })).status).toBe(400)
    expect(downloads).toBe(0)
    expect(f.state.files).toHaveLength(0)
  })
  it('404 when the object is not in Storage', async () => {
    const other = `${ORG}/${P}/${'0'.repeat(64)}.csv`
    expect((await call({ storagePath: other, originalName: 'a.csv' })).status).toBe(404)
  })
  it('400 when the bytes do not hash to the name', async () => {
    const lie = `${ORG}/${P}/${'1'.repeat(64)}.csv`
    ;(fake.current as ReturnType<typeof createFakeRepo>).state.raw[lie] = bytes
    const r = await call({ storagePath: lie, originalName: 'a.csv' })
    expect(r.status).toBe(400)
    expect(await r.json()).toMatchObject({ error: 'sha256_mismatch' })
  })
  it('201 creates the file row; 200 for the same bytes again (duplicate)', async () => {
    const r1 = await call({ storagePath: path, originalName: 'SITE A, 1, T, 10.csv' })
    expect(r1.status).toBe(201)
    const { fileId } = await r1.json()
    const r2 = await call({ storagePath: path, originalName: 'copy.csv' })
    expect(r2.status).toBe(200)
    expect(await r2.json()).toEqual({ fileId, duplicate: true, status: 'uploaded' })
  })
})
