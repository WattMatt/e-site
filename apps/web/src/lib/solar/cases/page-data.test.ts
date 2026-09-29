// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ shared: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', () => ({ loadStudyInputs: h.shared, contextForCase: h.ctx }))
import { loadYieldPageData, loadSolarReadinessExtra, loadHeadlineKpis } from './page-data'

const P = 'p1', S = 's1', ORG = 'o1'
const cfg = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
const H1 = 'a'.repeat(64), H2 = 'b'.repeat(64)
const kpis = { dcKwp: 500, acKw: 400, annualAcKwh: 800_000, pvAcKwh: 800_000, specificYieldKwhPerKwp: 1600 }
const outputs = { version: 1, kpis, monthly: Array.from({ length: 12 }, (_, i) => ({ month: i + 1, pvKwh: 1000 * (i + 1) })), typicalDays: [], daily: [], waterfall: [], checks: [], provenance: {} }
const tables = {
  'solar.cases': [
    { id: 'c1', study_id: S, project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1', created_at: '1' },
    { id: 'c2', study_id: S, project_id: P, name: 'Big', pv_source: 'manual', config: cfg, updated_at: 'T1', created_at: '2' },
  ],
  'solar.case_runs': [
    { id: 'r1', case_id: 'c1', project_id: P, status: 'succeeded', inputs_hash: H1, started_at: '2026-09-28T09:00:00Z', finished_at: '2026-09-28T09:00:05Z', run_by: 'u1', outputs },
    { id: 'r2', case_id: 'c2', project_id: P, status: 'succeeded', inputs_hash: H1, started_at: '2026-09-28T09:00:00Z', finished_at: '2026-09-28T09:00:05Z', run_by: 'u1', outputs },
  ],
  'solar.case_run_financials': [{ case_id: 'c1', case_run_id: 'r1', created_at: 'T', results: { year1Bills: { beforeZar: 1e6, afterZar: 6e5 }, finance: { lcoeZarPerKwh: 0.9, models: [{ model: 'cash', views: [{ view: 'owner', npvZar: 2e6, irr: 0.2, simplePaybackYears: 5, discountedPaybackYears: 7 }] }] } } }],
  'solar.equipment': [{ id: 'm1', organisation_id: null, kind: 'module', make: 'Generic', model: 'M', specs: { pmaxW: 550, gammaPmaxPctPerC: -0.35 }, retired_at: null }],
  'public.profiles': [{ id: 'u1', full_name: 'Arno' }],
}
// The real loader hands back a Float64Array (caseLoadFromSiteSeries) — the view model must not.
const series = new Float64Array(8760).fill(100)
series[4000] = 180
const shared = {
  study: { id: S, organisation_id: ORG, selected_case_id: 'c1', updated_at: 'T0', export_mode: 'net_billing', export_limit_kw: null },
  siteLoad: { series, basis: 'S1', referenceYear: 2025 },
  loadError: null, referenceYear: 2025,
  tariff: { ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' }, touPeriods: null,
}

beforeEach(() => {
  vi.clearAllMocks()
  h.shared.mockResolvedValue(shared)
  // c1 current (H1), c2 stale (H2)
  h.ctx.mockImplementation(async (_svc: unknown, _s: unknown, row: { id: string }) => ({ ok: true, ctx: { build: { ok: true }, currentHash: row.id === 'c1' ? H1 : H2, weather: null, config: cfg } }))
})

describe('loadYieldPageData', () => {
  it('cards: status per case from the stored runs vs the current hash; saving only for cost-view', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit_financials', {})
    expect(d.cases.map((c) => [c.id, c.status, c.selected, c.canSelect])).toEqual([['c1', 'done', true, true], ['c2', 'stale', false, true]])
    expect(d.cases[0]!.annualPvKwh).toBe(800_000)
    expect(d.cases[0]!.year1SavingZar).toBe(400_000)
    expect(d.equipment.modules.map((m) => m.id)).toEqual(['m1'])
    const view = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'view', {})
    expect(view.cases[0]!.year1SavingZar).toBeNull()
    expect(view.equipment.modules).toEqual([])
  })
  it('never reads money below edit_financials', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const user = fakeSupabase({ tables })
    await loadYieldPageData(user.client as never, svc as never, P, 'edit', { compare: 'c1,c2' })
    expect(user.calls.some((c) => c.table === 'solar.case_run_financials')).toBe(false)
  })
  it('editor opens ?case=, else the selected case; JSON-only; tariff reason passed through', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [], 'public.profiles': [{ id: 'u1', full_name: 'Arno' }] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { caseId: 'c2' })
    expect(d.editor!.caseId).toBe('c2')
    expect(d.editor!.lastRun!.runByName).toBe('Arno')
    expect(d.editor!.tariffNote).toBe('No tariff is pinned for this study — pin one on the Tariff tab.')
    expect(d.editor!.siteLoad).toEqual({ basis: 'S1', referenceYear: 2025, annualKwh: 876_080, peakKw: 180 })
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
    const d2 = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', {})
    expect(d2.editor!.caseId).toBe('c1')
  })
  it('the editor carries the build reasons of a case that cannot run', async () => {
    h.ctx.mockImplementation(async () => ({ ok: true, ctx: { build: { ok: false, reasons: ['Build the site load on the Load tab first.'] }, currentHash: null, weather: null, config: cfg } }))
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', {})
    expect(d.editor!.buildReasons).toEqual(['Build the site load on the Load tab first.'])
    expect(d.cases[0]!.status).toBe('stale')
  })
  it('compare 2–4 cases; ignores unknown ids; money only for cost-view', async () => {
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { compare: 'c1,c2,zz' })
    expect(d.compare!.map((c) => c.caseId)).toEqual(['c1', 'c2'])
    expect(d.compare![0]!.money).toBeNull()
    expect(d.compare![0]!.monthlyPvKwh).toHaveLength(12)
    expect((await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit', { compare: 'c1' })).compare).toBeNull()
    const fin = await loadYieldPageData(fakeSupabase({ tables }).client as never, svc as never, P, 'edit_financials', { compare: 'c1,c2' })
    expect(fin.compare![0]!.money).toEqual({ year1SavingZar: 400_000, irr: 0.2, npvZar: 2e6, simplePaybackYears: 5 })
  })
  it('no study → empty state data', async () => {
    h.shared.mockResolvedValueOnce(null)
    const d = await loadYieldPageData(fakeSupabase({}).client as never, {} as never, P, 'edit', {})
    expect(d).toMatchObject({ hasStudy: false, cases: [], editor: null })
  })
})

describe('money on the right run and the right view', () => {
  it('B3: a financial result on an OLDER run is not shown as the case’s money (card or compare)', async () => {
    const t = { ...tables, 'solar.case_run_financials': [{ ...tables['solar.case_run_financials'][0]!, case_run_id: 'r0-older' }] }
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables: t }).client as never, svc as never, P, 'edit_financials', { compare: 'c1,c2' })
    expect(d.cases[0]!.year1SavingZar).toBeNull()
    expect(d.compare![0]!.money).toBeNull()
  })
  it('B4: the headline view is chosen deliberately — cash owner if present, else the owner/client view, never an investor view', async () => {
    const res = (models: unknown[]) => ({ ...tables, 'solar.case_run_financials': [{ case_id: 'c1', case_run_id: 'r1', created_at: 'T', results: { year1Bills: { beforeZar: 1e6, afterZar: 6e5 }, finance: { lcoeZarPerKwh: 0.9, models } } }] })
    const ppa = { model: 'ppa', views: [{ view: 'investor', npvZar: 9e9, irr: 0.9, simplePaybackYears: 1 }, { view: 'client', npvZar: 3e5, irr: null, simplePaybackYears: null }] }
    const cash = { model: 'cash', views: [{ view: 'owner', npvZar: 2e6, irr: 0.2, simplePaybackYears: 5 }] }
    const k1 = await loadHeadlineKpis(fakeSupabase({ tables: res([ppa, cash]) }).client as never, P, 'edit_financials', 'c1')
    expect(k1!.money).toMatchObject({ npvZar: 2e6, irr: 0.2 })
    const k2 = await loadHeadlineKpis(fakeSupabase({ tables: res([ppa]) }).client as never, P, 'edit_financials', 'c1')
    expect(k2!.money).toMatchObject({ npvZar: 3e5, irr: null })
    const svc = fakeSupabase({ tables: { 'solar.org_settings': [] } }).client
    const d = await loadYieldPageData(fakeSupabase({ tables: res([ppa]) }).client as never, svc as never, P, 'edit_financials', { compare: 'c1,c2' })
    expect(d.compare![0]!.money).toMatchObject({ npvZar: 3e5 })
  })
  it('B5: the selected case with no saved financials reads as "using org defaults" at edit_financials', async () => {
    const x = await loadSolarReadinessExtra(fakeSupabase({ tables: { ...tables, 'solar.case_financials': [] } }).client as never, {} as never, P, 'edit_financials')
    expect(x.financials).toEqual({ capexZar: 0, hasModel: true, usingOrgDefaults: true, saved: false })
    const below = await loadSolarReadinessExtra(fakeSupabase({ tables: { ...tables, 'solar.case_financials': [] } }).client as never, {} as never, P, 'edit')
    expect(below.financials).toBeNull()
  })
})

describe('loadSolarReadinessExtra + loadHeadlineKpis', () => {
  it('reports the selected case status and flags stale', async () => {
    h.ctx.mockImplementation(async () => ({ ok: true, ctx: { build: { ok: true }, currentHash: H2, weather: null, config: cfg } }))
    const x = await loadSolarReadinessExtra(fakeSupabase({ tables }).client as never, {} as never, P, 'edit')
    expect(x.yield).toEqual({ caseCount: 2, selectedCaseId: 'c1', selectedStatus: 'stale' })
    expect(x.stale).toEqual({ caseId: 'c1', caseName: 'Base' })
    expect(x.layoutManual).toBe(true)
  })
  it('a current selected case is not stale', async () => {
    const x = await loadSolarReadinessExtra(fakeSupabase({ tables }).client as never, {} as never, P, 'edit')
    expect(x.yield!.selectedStatus).toBe('done')
    expect(x.stale).toBeNull()
  })
  it('headline KPIs from the selected case’s stored run; rand values only for cost-view', async () => {
    const k = await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit_financials', 'c1')
    expect(k).toMatchObject({ caseId: 'c1', caseName: 'Base', energy: { dcKwp: 500 }, money: { billBeforeZar: 1e6, billAfterZar: 6e5, savingZar: 4e5, irr: 0.2, npvZar: 2e6, lcoeZarPerKwh: 0.9, simplePaybackYears: 5 } })
    expect((await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit', 'c1'))!.money).toBeNull()
    expect(await loadHeadlineKpis(fakeSupabase({ tables }).client as never, P, 'edit', null)).toBeNull()
  })
})
