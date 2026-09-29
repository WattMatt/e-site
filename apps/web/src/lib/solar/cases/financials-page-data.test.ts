// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { buildFinanceInput, defaultCaseConfig, defaultFinanceConfig } from '@esite/shared/solar-cases'
import { solarOrgSettingDefaults } from '@esite/shared'

const h = vi.hoisted(() => ({ shared: vi.fn(), ctx: vi.fn() }))
vi.mock('./run-context', () => ({ loadStudyInputs: h.shared, contextForCase: h.ctx }))
import { loadFinancialsPageData } from './financials-page-data'
import { finInputsHash, FIN_RUN_REASONS } from './financials'

const P = 'p1', ORG = 'o1', H = 'a'.repeat(64)
const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 100, acKw: 80 })
const fin = { ...defaultFinanceConfig(s), capex: [{ id: 'a', category: 'modules' as const, description: 'PV', qty: 100_000, unit: 'Wp' as const, rateZar: 12, qualifies12b: true, source: 'manual' as const }] }
const tariffRef = { tariffId: 't1', tariffName: 'Flat', financialYear: '2025/26', licenseeName: 'City Power' }
const results = {
  capex: { exclVatZar: 1_200_000, vatZar: 180_000, inclVatZar: 1_380_000, zarPerWp: 12 },
  year1Bills: { beforeZar: 876_000, afterZar: 613_200, afterPvOnlyZar: 613_200, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: 0.95, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1_200_000, npvZar: 900_000, irr: 0.21, simplePaybackYears: 4.6, discountedPaybackYears: 6.2,
    rows: [{ year: 1, energyKwh: 1, billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, opexZar: 21_000, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: 241_800, cumulativeZar: -958_200 }] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 900_000, swing: 0.2, bars: [{ variable: 'capex', lowNpvZar: 1_140_000, highNpvZar: 660_000, spreadZar: 480_000 }] },
  engineVersion: '0.1.0',
}
const PRICING = { escalationPath: { published: [0.101, 0.09], startRate: 0.09, endRate: 0.07, linearToYear: 10, cpiMargin: 0.01 }, loadGrowthPct: 2, exportCredited: true,
  escalationRows: [{ year: 2, pct: 10.1, source: 'published', financialYear: '2026/27' }, { year: 10, pct: 7, source: 'default', financialYear: null }] }
const PH = 'p'.repeat(64)
const built = buildFinanceInput(fin, cfg, { dcKwp: 100, acKw: 80 }, PRICING)
const tables = (over: Record<string, unknown[]> = {}) => ({
  'solar.cases': [{ id: 'c1', study_id: 's1', project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1' }],
  'solar.case_runs': [{ id: 'r1', case_id: 'c1', project_id: P, status: 'succeeded', inputs_hash: H, started_at: '2026-09-28T09:00:00Z', config_snapshot: cfg, outputs: { kpis: { dcKwp: 100, acKw: 80, batteryKwh: null } } }],
  'solar.case_financials': [{ case_id: 'c1', config: fin, updated_at: 'F1' }],
  'solar.case_run_financials': [{ case_id: 'c1', case_run_id: 'r1', created_at: '2026-09-28T10:00:00Z', engine_version: '0.1.0', tariff_ref: tariffRef, fin_inputs_hash: built.ok ? finInputsHash(built.input, tariffRef, 'r1', PH) : '', results }],
  ...over,
})
const study = { id: 's1', organisation_id: ORG, selected_case_id: 'c1' }
const sharedOk = { study, siteLoad: null, loadError: null, referenceYear: 2025, touPeriods: null, tariff: { ok: true, tariffRef, pricing: PRICING, pricingHash: PH } }

beforeEach(() => {
  vi.clearAllMocks()
  h.shared.mockResolvedValue(sharedOk)
  h.ctx.mockResolvedValue({ ok: true, ctx: { currentHash: H, build: { ok: true } } })
})

describe('loadFinancialsPageData', () => {
  it('stored results become display columns (saving precomputed server-side); current → not stale', async () => {
    expect(built.ok).toBe(true)
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, undefined)
    expect(d.caseId).toBe('c1')
    expect(d.isDefault).toBe(false)
    expect(d.runReasons).toEqual([])
    expect(d.tariffReason).toBeNull()
    expect(d.studyPricing).toEqual({ loadGrowthPct: 2, escalationYear2Pct: 10.1, escalationYear10Pct: 7 })
    expect(d.financialsStale).toBe(false)
    expect(d.energyStale).toBe(false)
    expect(d.runSize).toEqual({ dcKwp: 100, acKw: 80, batteryKwh: null })
    expect(d.results!.year1).toEqual({ billBeforeZar: 876_000, billAfterZar: 613_200, savingZar: 262_800, exportCreditUsedZar: 0 })
    expect(d.results!.columns).toEqual([expect.objectContaining({ key: 'cash-owner', label: 'Cash purchase — owner', npvZar: 900_000, irr: 0.21, cumulativeZar: -958_200 })])
    expect(d.results!.tornado.bars[0]).toMatchObject({ variable: 'capex', label: 'Capex' })
    expect(d.results!.tariffLabel).toBe('City Power Flat 2025/26')
    // JSON only — the page hands this to client components.
    expect(JSON.parse(JSON.stringify(d))).toEqual(d)
  })
  it('B4: each column carries ITS party’s year-1 figure — owner saving, client net of payments, investor income', async () => {
    const r1 = (savingZar: number, financeZar: number) => ({ year: 1, energyKwh: 1, billBeforeZar: 0, billAfterZar: 0, savingZar, opexZar: 0, replacementZar: 0, taxZar: 0, financeZar, netZar: 0, cumulativeZar: 0 })
    const v = (view: string, row: unknown) => ({ view, upfrontZar: 0, npvZar: 1, irr: null, simplePaybackYears: null, discountedPaybackYears: null, rows: [row] })
    const models = [
      { model: 'cash', views: [v('owner', r1(262_800, 0))] },
      { model: 'ppa', views: [v('client', r1(262_800, 180_000)), v('investor', r1(0, -180_000))] },
    ]
    const t = tables({ 'solar.case_run_financials': [{ ...tables()['solar.case_run_financials']![0] as object, results: { ...results, finance: { ...results.finance, models } } }] })
    const d = await loadFinancialsPageData(fakeSupabase({ tables: t }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, undefined)
    expect(d.results!.columns.map((c) => [c.key, c.year1])).toEqual([
      ['cash-owner', { label: 'Year-1 bill saving', zar: 262_800 }],
      ['ppa-client', { label: 'Year-1 net saving', zar: 82_800 }],
      ['ppa-investor', { label: 'Year-1 income', zar: 180_000 }],
    ])
  })
  it('a changed saved config makes the stored financials stale', async () => {
    const changed = { ...fin, analysis: { ...fin.analysis, discountRatePct: 12 } }
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_financials': [{ case_id: 'c1', config: changed, updated_at: 'F2' }] }) }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(d.financialsStale).toBe(true)
  })
  it('YF-01: a degradation edit on Yield (after the run) shows Pricing changed — Re-run financials', async () => {
    const edited = { ...cfg, degradation: { firstYearPct: 0.5, annualPct: 0.2 } }
    // As production: runsByCase carries the run's finance-only inputs, and the case context the CURRENT config.
    const runs = [{ ...tables()['solar.case_runs']![0] as object, snap_degradation: cfg.degradation, snap_load_shedding: cfg.loadShedding }]
    const t = tables({ 'solar.cases': [{ ...tables()['solar.cases']![0] as object, config: edited }], 'solar.case_runs': runs })
    h.ctx.mockResolvedValueOnce({ ok: true, ctx: { currentHash: H, energyHash: 'e'.repeat(64), build: { ok: true }, config: edited } })
    const d = await loadFinancialsPageData(fakeSupabase({ tables: t }).client as never, fakeSupabase({ tables: t }).client as never, P, 'c1')
    expect(d.pricingChanged).toBe(true)
    expect(d.financialsStale).toBe(false) // the banner says it; the two never repeat each other
    // Unedited: Done, not stale.
    h.ctx.mockResolvedValueOnce({ ok: true, ctx: { currentHash: H, energyHash: 'e'.repeat(64), build: { ok: true }, config: cfg } })
    const t0 = tables({ 'solar.case_runs': runs })
    const d0 = await loadFinancialsPageData(fakeSupabase({ tables: t0 }).client as never, fakeSupabase({ tables: t0 }).client as never, P, 'c1')
    expect([d0.pricingChanged, d0.financialsStale]).toEqual([false, false])
  })
  it('YF-01: an unreadable current case config is named, not priced from the run snapshot', async () => {
    const cases = [{ ...tables()['solar.cases']![0] as object, config: { version: 99 } }]
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.cases': cases }) }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(d.runReasons).toContain(FIN_RUN_REASONS.badCase)
  })
  it('a newer succeeded run makes the stored financials stale', async () => {
    const runs = [
      { id: 'r2', case_id: 'c1', project_id: P, status: 'succeeded', inputs_hash: H, started_at: '2026-09-28T11:00:00Z', config_snapshot: cfg, outputs: { kpis: { dcKwp: 100, acKw: 80, batteryKwh: null } } },
      ...tables()['solar.case_runs'],
    ]
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_runs': runs }) }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(d.financialsStale).toBe(true)
  })
  it('a changed case hash makes the energy stale', async () => {
    h.ctx.mockResolvedValueOnce({ ok: true, ctx: { currentHash: 'b'.repeat(64), build: { ok: true } } })
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(d.energyStale).toBe(true)
  })
  it('no saved financials → org defaults, flagged, with the reason; no run → reason; no tariff → reason', async () => {
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_financials': [], 'solar.case_runs': [], 'solar.case_run_financials': [] }) }).client as never,
      fakeSupabase({ tables: { 'solar.org_settings': [{ organisation_id: ORG, settings: { values: { discount_rate_pct: 10 } } }] } }).client as never, P, 'c1')
    expect(d.isDefault).toBe(true)
    expect(d.configUpdatedAt).toBeNull()
    expect(d.config.analysis.discountRatePct).toBe(10)
    expect(d.runReasons).toEqual(['Run the case on Yield & Scenarios first.'])
    expect(d.results).toBeNull()

    const saved = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.case_financials': [] }) }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, 'c1')
    // Org defaults carry no capex lines, so the finance-input reason comes too.
    expect(saved.runReasons).toEqual(['Add capex lines (or apply the org rate card) first.', 'Save the financials first.'])

    h.shared.mockResolvedValueOnce({ ...sharedOk, tariff: { ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' } })
    const t = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({}).client as never, P, 'c1')
    expect(t.tariffReason).toBe('No tariff is pinned for this study — pin one on the Tariff tab.')
  })
  it('no study → hasStudy false; no cases → caseId null', async () => {
    h.shared.mockResolvedValueOnce(null)
    const a = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({}).client as never, P, undefined)
    expect(a.hasStudy).toBe(false)
    const b = await loadFinancialsPageData(fakeSupabase({ tables: tables({ 'solar.cases': [] }) }).client as never, fakeSupabase({}).client as never, P, undefined)
    expect(b).toMatchObject({ hasStudy: true, caseId: null })
  })
  it('an unknown ?case= falls back to the selected case', async () => {
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({}).client as never, P, 'nope')
    expect(d.caseId).toBe('c1')
  })
})

describe('I-1: a change to the study pricing marks the stored financials Stale', () => {
  it('(d) a Tariff-tab escalation change (the finance input moves)', async () => {
    h.shared.mockResolvedValue({ ...sharedOk, tariff: { ...sharedOk.tariff, pricing: { ...PRICING, escalationPath: { ...PRICING.escalationPath, published: [0.2, 0.09] } } } })
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, undefined)
    expect(d.financialsStale).toBe(true)
  })
  it('an override / export-rule change (the pricing hash moves)', async () => {
    h.shared.mockResolvedValue({ ...sharedOk, tariff: { ...sharedOk.tariff, pricingHash: 'q'.repeat(64) } })
    const d = await loadFinancialsPageData(fakeSupabase({ tables: tables() }).client as never, fakeSupabase({ tables: { 'solar.org_settings': [] } }).client as never, P, undefined)
    expect(d.financialsStale).toBe(true)
  })
})
