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

import { createFakeRepo } from '@/lib/solar/meter-import/fake-repo'
import { POST } from './route'

const ORG = '0f8fad5b-d9cb-469f-a165-70867728950e'
const P = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const F1 = '3b241101-e2bb-4255-8caf-4136c566a962'
const A = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\n10/03/2025 01:00:00,3\r\n')
// Real content hash + exact path: the commit re-verifies both before re-parsing (deviation from the plan placeholders).
const SHA_A = createHash('sha256').update(A).digest('hex')
const PATH_A = `${ORG}/${P}/${SHA_A}.csv`
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({
    orgByProject: { [P]: ORG }, raw: { [PATH_A]: A },
    files: [{ id: F1, organisation_id: ORG, project_id: P, sha256: SHA_A, size_bytes: A.byteLength, storage_path: PATH_A, original_name: 'SITE A, 1, T, 10.csv', status: 'parsed' }],
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
  it('re-committing the same file through the route writes no duplicate channel or reading', async () => {
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    const first = await (await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'tenant' } }, identity: { resolution: 'none' } })).json()
    // The fake issues 'meter-1'-style ids; the body schema wants a UUID, as the DB would issue.
    const MID = '5d5e3c3a-2f7b-4c55-9d4e-0a1b2c3d4e5f'
    for (const m of s.meters) if (m.id === first.meterId) m.id = MID
    for (const c of s.channels) if (c.meter_id === first.meterId) c.meter_id = MID
    for (const h of s.hashes) if (h.meter_id === first.meterId) h.meter_id = MID
    const again = await call({ mode: 'series', fileId: F1, meter: { existingMeterId: MID }, identity: { resolution: 'none' } })
    expect(again.status).toBe(200)
    expect(s.meters).toHaveLength(1)
    expect(s.channels).toHaveLength(1)
    expect(s.readings.get(s.channels[0].id)?.size).toBe(3)
  })
  it('409 and nothing written when the stored bytes no longer hash to the recorded sha256', async () => {
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    s.raw[PATH_A] = new TextEncoder().encode('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,999\r\n')
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'tenant' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(409)
    expect(await r.json()).toMatchObject({ error: 'sha256_mismatch' })
    expect(s.meters).toHaveLength(0)
    expect(s.channels).toHaveLength(0)
    expect(s.writeCalls).toHaveLength(0)
  })
  it('422 and no download when the recorded path is not <org>/<project>/<sha>.<ext> of this project', async () => {
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    const foreign = `11111111-1111-4111-8111-111111111111/${P}/${SHA_A}.csv`
    s.raw[foreign] = A
    s.files[0].storage_path = foreign
    const r = await call({ mode: 'series', fileId: F1, meter: { new: { label: 'T', kind: 'tenant' } }, identity: { resolution: 'none' } })
    expect(r.status).toBe(422)
    expect(await r.json()).toEqual({ error: 'raw_path_invalid' })
    expect(s.meters).toHaveLength(0)
  })
})
