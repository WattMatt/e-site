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
const F2 = '6fa459ea-ee8a-3ca4-894e-db77e160355e'
const enc = (s: string) => new TextEncoder().encode(s)
const A = enc('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,1\r\n10/03/2025 00:30:00,2\r\n10/03/2025 01:00:00,3\r\n')
const EMPTY = enc('sep=,\r\n\r\n')
// Real content hashes and the exact <org>/<project>/<sha>.<ext> paths the register route accepts:
// the parse route re-verifies both before parsing (deviation from the plan's placeholder fixtures).
const shaOf = (b: Uint8Array) => createHash('sha256').update(b).digest('hex')
const SHA_A = shaOf(A)
const SHA_E = shaOf(EMPTY)
const PATH_A = `${ORG}/${P}/${SHA_A}.csv`
const PATH_E = `${ORG}/${P}/${SHA_E}.csv`
const call = (b: unknown) => POST(new Request('http://x', { method: 'POST', body: JSON.stringify(b) }), { params: Promise.resolve({ id: P }) })

beforeEach(() => {
  gateMock.mockReset()
  gateMock.mockResolvedValue({ ok: true, level: 'edit', userId: 'u1' })
  fake.current = createFakeRepo({
    orgByProject: { [P]: ORG },
    raw: { [PATH_A]: A, [PATH_E]: EMPTY },
    files: [
      { id: F1, organisation_id: ORG, project_id: P, sha256: SHA_A, size_bytes: A.byteLength, storage_path: PATH_A, original_name: 'SITE A, 1, T, 10.csv', status: 'uploaded' },
      { id: F2, organisation_id: ORG, project_id: P, sha256: SHA_E, size_bytes: EMPTY.byteLength, storage_path: PATH_E, original_name: 'e.csv', status: 'uploaded' },
    ],
  })
})

describe('POST …/meter-files/parse', () => {
  it('returns one review per file, stores a report and the detected facts', async () => {
    const r = await call({ fileIds: [F1, F2, '11111111-1111-4111-8111-111111111111'] })
    expect(r.status).toBe(200)
    const { results } = await r.json()
    expect(results[0]).toMatchObject({ fileId: F1, reviews: [{ outcome: 'series', format: 'A', canAccept: true }] })
    expect(results[1]).toMatchObject({ fileId: F2, reviews: [{ outcome: 'rejected', blockingErrors: ['empty_file'] }] })
    expect(results[2]).toEqual({ fileId: '11111111-1111-4111-8111-111111111111', error: 'not_found' })
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    expect(s.reports).toHaveLength(2)
    expect(s.filePatches.find((p) => p.fileId === F1)?.patch).toMatchObject({ detected_format: 'A', status: 'parsed' })
    expect(s.filePatches.find((p) => p.fileId === F2)?.patch).toMatchObject({ status: 'skipped', skip_reason: 'empty_file' })
  })
  it('400 for a unit choice commit would refuse (m3, unknown): preview and commit accept the same units', async () => {
    expect((await call({ fileIds: [F1], options: { [F1]: { units: { p14: 'm3' } } } })).status).toBe(400)
    expect((await call({ fileIds: [F1], options: { [F1]: { units: { p14: 'unknown' } } } })).status).toBe(400)
  })
  it('400 for an empty or oversized list', async () => {
    expect((await call({ fileIds: [] })).status).toBe(400)
    expect((await call({ fileIds: Array(21).fill(F1) })).status).toBe(400)
  })
  it('applies per-file options (the dialog re-runs the preview with a user choice)', async () => {
    const r = await call({ fileIds: [F1], options: { [F1]: { units: { p14: 'kWh' } } } })
    const { results } = await r.json()
    expect(results[0].reviews[0].channels[0]).toMatchObject({ sourceUnit: 'kWh', unitFromTable: false })
  })
  it('never parses stored bytes that no longer hash to the recorded sha256', async () => {
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    s.raw[PATH_A] = enc('sep=,\r\n\r\ndate,p14\r\n10/03/2025 00:00:00,999\r\n')
    const { results } = await (await call({ fileIds: [F1] })).json()
    expect(results[0]).toEqual({ fileId: F1, error: 'sha256_mismatch' })
    expect(s.reports).toHaveLength(0)
    expect(s.filePatches).toHaveLength(0)
  })
  it('never downloads a recorded path that is not <org>/<project>/<sha>.<ext> of this project', async () => {
    const s = (fake.current as ReturnType<typeof createFakeRepo>).state
    const foreign = `11111111-1111-4111-8111-111111111111/${P}/${SHA_A}.csv`
    s.raw[foreign] = A
    s.files[0].storage_path = foreign
    const { results } = await (await call({ fileIds: [F1] })).json()
    expect(results[0]).toEqual({ fileId: F1, error: 'raw_path_invalid' })
    expect(s.reports).toHaveLength(0)
  })
})
