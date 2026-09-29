import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextResponse } from 'next/server'
import { fakeSupabase } from '@/test/fake-supabase'
import { encodeHourlyCsv } from '@esite/shared/solar-cases'

const h = vi.hoisted(() => ({ gate: vi.fn(), user: { current: null as unknown }, get: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: vi.fn(async () => h.user.current), createServiceClient: () => ({}) }))
vi.mock('@/lib/solar/api-gate', () => ({ requireSolarLevelAPI: h.gate }))
vi.mock('@/lib/solar/cases/storage', async (o) => ({ ...(await o<typeof import('@/lib/solar/cases/storage')>()), getGzipText: h.get }))
import { GET, runtime } from './route'

const P = '11111111-1111-4111-8111-111111111111', C = '22222222-2222-4222-8222-222222222222', R = '33333333-3333-4333-8333-333333333333'
const series = () => { const z = () => new Float64Array(8760).fill(1); return { load: z(), pvAc: z(), selfUse: z(), import: z(), export: z(), curtail: z(), soc: z(), importPvOnly: z(), exportPvOnly: z() } }
const run = { id: R, case_id: C, project_id: P, status: 'succeeded', hourly_path: 'o/p/c/r.csv.gz', outputs: { monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 1, loadKwh: 2, importBeforeKwh: 2, importKwh: 1, exportKwh: 0, maxDemandBeforeKw: 3, maxDemandAfterKw: 2, touImportBefore: null, touImportAfter: null })) } }
const call = (q: string, runId = R) => GET(new Request(`http://x/?${q}`), { params: Promise.resolve({ id: P, caseId: C, runId }) })

beforeEach(() => { vi.clearAllMocks(); h.gate.mockResolvedValue({ ok: true, level: 'view', userId: 'u1' }); h.user.current = fakeSupabase({ tables: { 'solar.case_runs': [run] } }).client })

describe('GET …/runs/[runId]/export', () => {
  it('declares nodejs; refuses a malformed id', async () => {
    expect(runtime).toBe('nodejs')
    expect((await call('kind=hourly', 'nope')).status).toBe(400)
  })
  it('gates View (read) FIRST and reads the run through the caller’s session', async () => {
    h.gate.mockResolvedValueOnce({ ok: false, response: NextResponse.json({}, { status: 403 }) })
    expect((await call('kind=hourly')).status).toBe(403)
    expect(h.gate).toHaveBeenCalledWith(h.user.current, P, 'view')
    expect(h.get).not.toHaveBeenCalled()
  })
  it('hourly → the decompressed 8760 CSV as an attachment', async () => {
    h.get.mockResolvedValue(encodeHourlyCsv(series()))
    const res = await call('kind=hourly')
    expect(res.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(res.headers.get('content-disposition')).toMatch(/attachment; filename="solar-run-33333333-hourly\.csv"/)
    expect((await res.text()).split('\n')).toHaveLength(8762)
    expect(h.get).toHaveBeenCalledWith({}, 'solar-runs', 'o/p/c/r.csv.gz')
  })
  it('monthly → CSV from the stored outputs (no recomputation)', async () => {
    const res = await call('kind=monthly')
    expect((await res.text()).split('\n')[1]).toBe('1,1.000,2.000,2.000,1.000,0.000,3.000,2.000,,,,,,')
    expect(h.get).not.toHaveBeenCalled()
  })
  it('slice → JSON rows for up to 31 whole days; refuses more', async () => {
    h.get.mockResolvedValue(encodeHourlyCsv(series()))
    const ok = await call('kind=slice&from=0&to=1')
    expect((await ok.json()).rows).toHaveLength(48)
    expect((await call('kind=slice&from=0&to=40')).status).toBe(400)
    expect((await call('kind=slice&from=x&to=1')).status).toBe(400)
  })
  it('unknown kind → 400', async () => {
    expect((await call('kind=pdf')).status).toBe(400)
  })
  it('unknown / unfinished run → 404', async () => {
    h.user.current = fakeSupabase({ tables: { 'solar.case_runs': [{ ...run, status: 'running' }] } }).client
    expect((await call('kind=hourly')).status).toBe(404)
    h.user.current = fakeSupabase({ tables: { 'solar.case_runs': [] } }).client
    expect((await call('kind=monthly')).status).toBe(404)
  })
  it('a lost stored file → 404 sentence, not a 500', async () => {
    h.get.mockRejectedValue(new Error('stored file not found'))
    const res = await call('kind=hourly')
    expect(res.status).toBe(404)
    await expect(res.json()).resolves.toEqual({ error: 'The stored hourly file for this run is missing — re-run the case.' })
  })
})
