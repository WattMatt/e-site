// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { parsePvgisTmyCsv, tmyToReferenceYear, ENGINE_VERSION, inputsHash } from '@esite/shared/solar-engine'
import { buildCaseInput, defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import { jhbTmyCsv } from './__fixtures__/weather'

const h = vi.hoisted(() => ({ ctx: vi.fn(), weather: vi.fn(), put: vi.fn(async () => {}), remove: vi.fn(async () => {}) }))
vi.mock('./run-context', () => ({ loadRunContext: h.ctx }))
vi.mock('./weather', () => ({ loadWeatherYear: h.weather }))
vi.mock('./storage', async (o) => ({ ...(await o<typeof import('./storage')>()), putGzipText: h.put, removeObject: h.remove }))
import { executeCaseRun, RUN_REASONS } from './run-case'

// Real engine on the stored Johannesburg PVGIS fixture; context, weather file and storage are mocked (no network).
const P = 'p1', C = 'c1', ORG = 'o1', U = 'u1', W = '22222222-2222-4222-8222-222222222222'
function ctx() {
  const c0 = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 200, acKw: 160 })
  const config = { ...c0, pv: { ...c0.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy' as const, datasetId: W } }
  const siteLoad = { series: new Float64Array(8760).fill(80), basis: 'S1', referenceYear: 2024 }
  const build = buildCaseInput({ config, study: { exportMode: 'net_billing', exportLimitKw: null }, siteLoad, touPeriods: null })
  return {
    ok: true, ctx: {
      study: { id: 's1', project_id: P, organisation_id: ORG, nmd_kva: 300, load_basis: 'S1', reference_year: 2024 },
      siteLoad, loadError: null, referenceYear: 2024, tariff: { ok: false, reason: 'x' }, touPeriods: null,
      caseRow: { id: C, config }, config, weather: { id: W, storage_path: 'o1/w.csv.gz', fetched_at: '2026-09-28T00:00:00Z', gsa_pvout_kwh_per_kwp: 1750 },
      build, currentHash: build.ok ? inputsHash(build.input) : null,
    },
  }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.ctx.mockResolvedValue(ctx())
  h.weather.mockResolvedValue(tmyToReferenceYear(parsePvgisTmyCsv(jhbTmyCsv()), 'PVGIS TMY (PVGIS-SARAH2)'))
})

describe('executeCaseRun', () => {
  it('inserts the running row through the USER session, finishes it through the SERVICE client, stores the CSV', async () => {
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [{ id: 'r1' }] } } })
    const out = await executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U, now: () => Date.parse('2026-09-28T12:00:00Z') })
    expect(out).toEqual({ ok: true, runId: 'r1', status: 'succeeded' })
    const ins = callsTo(user.calls, 'solar.case_runs', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ case_id: C, engine_version: ENGINE_VERSION, weather_dataset_id: W, tariff_ref: null })
    expect(ins.inputs_hash).toBe(ctx().ctx.currentHash)
    expect(h.put).toHaveBeenCalledWith(svc.client, 'solar-runs', `${ORG}/${P}/${C}/r1.csv.gz`, expect.stringMatching(/^hour,start_sast,/))
    const upd = callsTo(svc.calls, 'solar.case_runs', 'update')
    // [0] closes timed-out runs; [1] finishes this one, conditioned on still running
    expect(upd[0]!.payload).toMatchObject({ status: 'failed' })
    // The sweep runs on the service client BEFORE the context check, so it is scoped to this project too.
    expect(upd[0]!.filters).toEqual(expect.arrayContaining([['eq', 'case_id', C], ['eq', 'project_id', P], ['eq', 'status', 'running'], ['lt', 'started_at', '2026-09-28T11:58:30.000Z']]))
    expect(upd[1]!.payload).toMatchObject({ status: 'succeeded', hourly_path: `${ORG}/${P}/${C}/r1.csv.gz` })
    expect(upd[1]!.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'running']]))
    const outputs = (upd[1]!.payload as { outputs: { kpis: { dcKwp: number }; provenance: { gsaPvoutKwhPerKwp: number; loadReferenceYear: number; loadBasis: string } } }).outputs
    expect(outputs.kpis.dcKwp).toBe(200)
    expect(outputs.provenance.gsaPvoutKwhPerKwp).toBe(1750)
    expect(outputs.provenance.loadReferenceYear).toBe(2024)
    expect(outputs.provenance.loadBasis).toBe('S1')
  })

  it('a context that cannot load keeps its status and sentence', async () => {
    h.ctx.mockResolvedValue({ ok: false, status: 404, error: 'Case not found.' })
    await expect(executeCaseRun({ user: fakeSupabase({}).client as never, svc: fakeSupabase({}).client as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 404, error: 'Case not found.' })
  })

  it('inputs that cannot be built → 422 with every reason, nothing inserted', async () => {
    h.ctx.mockResolvedValue({ ok: true, ctx: { ...ctx().ctx, build: { ok: false, reasons: ['A.', 'B.'] } } })
    const user = fakeSupabase({})
    const out = await executeCaseRun({ user: user.client as never, svc: fakeSupabase({}).client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 422, error: 'A. B.' })
    expect(callsTo(user.calls, 'solar.case_runs', 'insert')).toHaveLength(0)
  })

  it('a run already in progress → 409; a View user refused by RLS → 403', async () => {
    const svc = fakeSupabase({}).client as never
    const dup = fakeSupabase({ writes: { 'solar.case_runs:insert': { error: { code: '23505', message: 'dup' } } } })
    await expect(executeCaseRun({ user: dup.client as never, svc, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 409, error: 'A run of this case is already in progress.' })
    const rls = fakeSupabase({ writes: { 'solar.case_runs:insert': { error: { code: '42501', message: 'rls' } } } })
    await expect(executeCaseRun({ user: rls.client as never, svc, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 403, error: 'You need Edit access to run a case.' })
  })

  it('the finishing UPDATE fails: NOT reported as cancelled — marked failed with a sentence, CSV removed, 500', async () => {
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({ writes: { 'solar.case_runs:update': { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } } } })
    const out = await executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 500, error: RUN_REASONS.notSaved, runId: 'r1' })
    const last = callsTo(svc.calls, 'solar.case_runs', 'update').at(-1)!
    expect(last.payload).toEqual({ status: 'failed', error: RUN_REASONS.notSaved })
    expect(last.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'running']]))
    expect(h.remove).toHaveBeenCalledWith(svc.client, 'solar-runs', `${ORG}/${P}/${C}/r1.csv.gz`)
  })

  it('cancelled while running: the final update finds 0 rows → CSV removed, 409', async () => {
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({ writes: { 'solar.case_runs:update': { data: [] } } })
    await expect(executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 409, error: 'The run was cancelled.', runId: 'r1' })
    expect(h.remove).toHaveBeenCalledWith(svc.client, 'solar-runs', `${ORG}/${P}/${C}/r1.csv.gz`)
  })

  it('an engine/weather failure is recorded on the row as a fixed sentence — never the raw backend text', async () => {
    h.weather.mockRejectedValueOnce(new Error('connect ECONNREFUSED 10.0.0.7:5432 storage/v1/object/solar-weather'))
    const user = fakeSupabase({ writes: { 'solar.case_runs:insert': { data: [{ id: 'r1' }] } } })
    const svc = fakeSupabase({})
    const out = await executeCaseRun({ user: user.client as never, svc: svc.client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 500, error: RUN_REASONS.failed, runId: 'r1' })
    expect(RUN_REASONS.failed).not.toMatch(/ECONNREFUSED|storage/)
    const fail = callsTo(svc.calls, 'solar.case_runs', 'update').at(-1)!
    expect(fail.payload).toEqual({ status: 'failed', error: RUN_REASONS.failed })
    expect(fail.filters).toEqual(expect.arrayContaining([['eq', 'id', 'r1'], ['eq', 'status', 'running']]))
  })
})
