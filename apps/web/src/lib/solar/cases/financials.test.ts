// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { defaultCaseConfig, defaultFinanceConfig, encodeHourlyCsv } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'
import { ENGINE_VERSION, type BillCalculator } from '@esite/shared/solar-engine'

const h = vi.hoisted(() => ({ tariff: vi.fn(), get: vi.fn() }))
vi.mock('./tariff', () => ({ resolveStudyTariff: h.tariff }))
vi.mock('./storage', async (o) => ({ ...(await o<typeof import('./storage')>()), getGzipText: h.get }))
import { executeFinancialsRun, FIN_RUN_REASONS } from './financials'

// Stored hourly CSV + a stub tariff; no network, no re-simulation.
const P = 'p1', C = 'c1', R = 'r1', U = 'u1'
const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 100, acKw: 80 })
const fin = { ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules', description: 'PV', qty: 100_000, unit: 'Wp', rateZar: 12, qualifies12b: true, source: 'manual' }] }
const hourly = () => { const z = (v: number) => new Float64Array(8760).fill(v); return { load: z(50), pvAc: z(15), selfUse: z(15), import: z(35), export: z(0), curtail: z(0), soc: z(0), importPvOnly: z(35), exportPvOnly: z(0) } }
const run = { id: R, case_id: C, project_id: P, status: 'succeeded', hourly_path: 'o/p/c/r.csv.gz', config_snapshot: cfg, started_at: '2026-09-28T10:00:00Z',
  outputs: { kpis: { dcKwp: 100, acKw: 80, annualAcKwh: 131_400, deliveredKwh: 131_400 }, provenance: { loadReferenceYear: 2024 } } }
const calc: BillCalculator = {
  monthlyBills: (f) => Array.from({ length: 12 }, (_, i) => ({ month: i + 1, totalZar: f.importKwh.reduce((a, v) => a + v, 0) * 2 / 12, exportCreditUsedZar: 0 })),
  withExportRateScaled: () => calc,
}
const tables = { 'solar.case_runs': [run], 'solar.case_financials': [{ case_id: C, project_id: P, config: fin }] }

beforeEach(() => {
  vi.clearAllMocks()
  h.get.mockResolvedValue(encodeHourlyCsv(hourly()))
  h.tariff.mockResolvedValue({ ok: true, calc, tariffRef: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' } })
})

describe('executeFinancialsRun', () => {
  it('prices the latest succeeded run’s stored series and records an immutable result through the SERVICE client with run_by', async () => {
    const svcFake = fakeSupabase({ writes: { 'solar.case_run_financials:insert': { data: [{ id: 'f1' }] } } })
    const svc = svcFake.client
    const user = fakeSupabase({ tables })
    const out = await executeFinancialsRun({ user: user.client as never, svc: svc as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: true, id: 'f1' })
    // 00215: authenticated has no INSERT on case_run_financials — a user-session insert could post any figures.
    expect(callsTo(user.calls, 'solar.case_run_financials', 'insert')).toHaveLength(0)
    const ins = callsTo(svcFake.calls, 'solar.case_run_financials', 'insert')[0]!.payload as Record<string, any> // eslint-disable-line @typescript-eslint/no-explicit-any
    expect(ins).toMatchObject({ case_run_id: R, engine_version: ENGINE_VERSION, tariff_ref: { tariffId: 't1' }, run_by: U })
    expect(ins.fin_inputs_hash).toMatch(/^[0-9a-f]{64}$/)
    expect(ins.results.year1Bills.beforeZar).toBeCloseTo(50 * 8760 * 2, 3)
    expect(ins.results.year1Bills.afterZar).toBeCloseTo(35 * 8760 * 2, 3)
    expect(ins.results.capex.exclVatZar).toBe(1_200_000)
    expect(ins.results.finance.models[0].model).toBe('cash')
    expect(ins.results.tornado.bars.length).toBeGreaterThan(0)
    // The tariff is priced on the stored run's load reference year; the file comes from the service client.
    expect(h.tariff).toHaveBeenCalledWith(svc, P, { year: 2024 })
    expect(h.get).toHaveBeenCalledWith(svc, 'solar-runs', 'o/p/c/r.csv.gz')
  })
  it('a run whose export earns no credit ("Yes (no credit)") is priced with zero export credit', async () => {
    // A calculator that credits export at R 1/kWh, and a stored series that exports 5 kWh every hour.
    const crediting: BillCalculator = {
      monthlyBills: (f) => Array.from({ length: 12 }, (_, i) => {
        const imp = f.importKwh.reduce((a, v) => a + v, 0) * 2 / 12, exp = f.exportKwh.reduce((a, v) => a + v, 0) / 12
        return { month: i + 1, totalZar: imp - exp, exportCreditUsedZar: exp }
      }),
      withExportRateScaled: () => crediting,
    }
    h.tariff.mockResolvedValue({ ok: true, calc: crediting, tariffRef: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' } })
    h.get.mockResolvedValue(encodeHourlyCsv({ ...hourly(), export: new Float64Array(8760).fill(5), exportPvOnly: new Float64Array(8760).fill(5) }))
    const after = async (exportSettings: unknown) => {
      const svcFake = fakeSupabase()
      const user = fakeSupabase({ tables: { ...tables, 'solar.case_runs': [{ ...run, export_settings: exportSettings }] } })
      await executeFinancialsRun({ user: user.client as never, svc: svcFake.client as never, projectId: P, caseId: C, userId: U })
      return (callsTo(svcFake.calls, 'solar.case_run_financials', 'insert')[0]!.payload as { results: { year1Bills: { afterZar: number; exportCreditUsedZar: number } } }).results.year1Bills
    }
    const credited = await after({ allowed: true, limitKw: null })
    const none = await after({ allowed: true, limitKw: null, credited: false })
    expect(credited.afterZar).toBeCloseTo(35 * 8760 * 2 - 5 * 8760, 3)
    expect(none.afterZar).toBeCloseTo(35 * 8760 * 2, 3)   // = the zero-export after-bill
    expect(none.exportCreditUsedZar).toBe(0)
  })
  it('reads are scoped to the project: another project’s case / financials → not found', async () => {
    const other = fakeSupabase({ tables: { 'solar.case_runs': [{ ...run, project_id: 'p2' }], 'solar.case_financials': [{ case_id: C, project_id: 'p2', config: fin }] } })
    await expect(executeFinancialsRun({ user: other.client as never, svc: fakeSupabase().client as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noRun })
    const u = fakeSupabase({ tables })
    await executeFinancialsRun({ user: u.client as never, svc: fakeSupabase().client as never, projectId: P, caseId: C, userId: U })
    expect(callsTo(u.calls, 'solar.case_runs', 'select')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'project_id', P]]))
    expect(callsTo(u.calls, 'solar.case_financials', 'select')[0]!.filters).toEqual(expect.arrayContaining([['eq', 'project_id', P]]))
  })
  it('an engine validation failure → a human sentence, not the engine’s own message', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const bad: BillCalculator = { monthlyBills: () => [], withExportRateScaled: () => bad }
    h.tariff.mockResolvedValueOnce({ ok: true, calc: bad, tariffRef: { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' } })
    const out = await executeFinancialsRun({ user: fakeSupabase({ tables }).client as never, svc: fakeSupabase().client as never, projectId: P, caseId: C, userId: U })
    expect(out).toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.computeFailed })
    expect(FIN_RUN_REASONS.computeFailed).not.toMatch(/BillCalculator|monthly bills/)
    err.mockRestore()
  })
  it('no succeeded run / no saved financials / no tariff → the named sentence (422)', async () => {
    const empty = fakeSupabase({ tables: { 'solar.case_runs': [], 'solar.case_financials': [] } }).client as never
    await expect(executeFinancialsRun({ user: empty, svc: {} as never, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noRun })
    const noFin = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [] } }).client as never
    await expect(executeFinancialsRun({ user: noFin, svc: {} as never, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials })
    h.tariff.mockResolvedValueOnce({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    const ok = fakeSupabase({ tables }).client as never
    await expect(executeFinancialsRun({ user: ok, svc: {} as never, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 422, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
  })
  it('invalid saved financials / no capex → sentences before any tariff or file read', async () => {
    const bad = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [{ case_id: C, project_id: P, config: { version: 99 } }] } }).client as never
    await expect(executeFinancialsRun({ user: bad, svc: {} as never, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.badFinancials })
    const noCapex = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [{ case_id: C, project_id: P, config: defaultFinanceConfig(s) }] } }).client as never
    await expect(executeFinancialsRun({ user: noCapex, svc: {} as never, projectId: P, caseId: C, userId: U })).resolves.toEqual({ ok: false, status: 422, error: 'Add capex lines (or apply the org rate card) first.' })
    expect(h.tariff).not.toHaveBeenCalled()
    expect(h.get).not.toHaveBeenCalled()
  })
  it('the money gate is the caller’s own read: no readable financials → nothing priced, nothing written', async () => {
    // Below edit_financials, money RLS returns no case_financials row to the caller's session.
    const svcFake = fakeSupabase()
    const noMoney = fakeSupabase({ tables: { 'solar.case_runs': [run], 'solar.case_financials': [] } }).client as never
    await expect(executeFinancialsRun({ user: noMoney, svc: svcFake.client as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 422, error: FIN_RUN_REASONS.noFinancials })
    expect(svcFake.calls).toHaveLength(0)
    expect(h.tariff).not.toHaveBeenCalled()
  })
  it('a failed service insert → 500 sentence; a lost file → 500 sentence', async () => {
    const svcErr = fakeSupabase({ writes: { 'solar.case_run_financials:insert': { error: { code: '23514', message: 'financials need a completed run' } } } }).client as never
    const out = await executeFinancialsRun({ user: fakeSupabase({ tables }).client as never, svc: svcErr, projectId: P, caseId: C, userId: U })
    expect(out).toMatchObject({ ok: false, status: 500 })
    expect((out as { error: string }).error).not.toMatch(/completed run/)
    h.get.mockRejectedValueOnce(new Error('stored file not found'))
    await expect(executeFinancialsRun({ user: fakeSupabase({ tables }).client as never, svc: {} as never, projectId: P, caseId: C, userId: U }))
      .resolves.toEqual({ ok: false, status: 500, error: FIN_RUN_REASONS.fileMissing })
  })
})
