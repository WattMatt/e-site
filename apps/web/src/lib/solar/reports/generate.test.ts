import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  sel: vi.fn(), money: vi.fn(), brandData: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-report')),
}))
vi.mock('./selected-case', async (orig) => ({ ...(await orig<typeof import('./selected-case')>()), loadSelectedCase: h.sel }))
vi.mock('@/lib/solar/cases/page-data', () => ({ latestMoney: h.money }))
vi.mock('./branding-loader', () => ({ loadSolarBrandingData: h.brandData }))
vi.mock('./render-report', () => ({ renderSolarReport: h.render }))

import { generateSolarReport } from './generate'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

const outputs = {
  version: 1, kpis: { dcKwp: 500, acKw: 400, specificYieldKwhPerKwp: 1690, performanceRatio: 0.8, annualAcKwh: 845_000, pvAcKwh: 845_000, deliveredKwh: 840_000, selfConsumedKwh: 700_000, exportKwh: 140_000, curtailedKwh: 0, loadKwh: 1_440_000, importBeforeKwh: 1_440_000, importAfterKwh: 740_000, solarFraction: 0.49, selfConsumption: 0.83, peakDemandBeforeKw: 420, peakDemandAfterKw: 380, peakDemandBasis: 'hourly', batteryKwh: null, batteryKw: null },
  monthly: [], typicalDays: [], daily: [], waterfall: [], checks: [],
  provenance: { engineVersion: '0.1.0', inputsHash: 'a'.repeat(64), weatherDatasetId: 'w', weatherSource: 'PVGIS TMY', weatherFetchedAt: null, gsaPvoutKwhPerKwp: null, tariffRef: null, loadBasis: 'metered', loadReferenceYear: 2025 },
}
const selOk = (pv: 'manual' | 'layout' = 'manual') => ({
  ok: true,
  shared: { study: { id: 's1', organisation_id: 'o1', latitude: -25.7, longitude: 28.2, export_mode: 'net_billing', export_limit_kw: null, nmd_kva: 800 } },
  caseRow: { id: 'c1', name: 'Base', pv_source: pv, layout_id: pv === 'layout' ? 'L1' : null },
  run: { id: 'r1', finishedAt: '2026-09-28T10:00:00Z', inputsHash: 'a'.repeat(64), outputs, configSnapshot: {}, hourlyPath: 'x' },
})
const finRow = { case_id: 'c1', case_run_id: 'r1', results: {
  capex: { exclVatZar: 1, vatZar: 0, inclVatZar: 1, zarPerWp: null, inverterZar: 0, batteryZar: 0, qualifying12bZar: 0, byCategory: {} },
  year1Bills: { beforeZar: 1_000_000, afterZar: 600_000, afterPvOnlyZar: 600_000, exportCreditUsedZar: 0 },
  finance: { lcoeZarPerKwh: null, loadShedding: null, models: [{ model: 'cash', views: [{ view: 'owner', upfrontZar: 1, npvZar: 1, irr: 0.2, simplePaybackYears: 3, discountedPaybackYears: 4, rows: [] }] }] },
  tornado: { model: 'cash', view: 'owner', baseNpvZar: 1, swing: 0.2, bars: [], omitted: [] } } }

function setup(reportRows: Array<Record<string, unknown>> = []) {
  const svc = withStorage(fakeSupabase({ tables: {
    'projects.reports': reportRows, 'projects.projects': [{ id: 'p1', name: 'Acme', address: null, city: null, province: null }],
    'solar.studies': [{ project_id: 'p1', licensee_name: 'City of Tshwane' }], 'solar.proposal_templates': [],
  }, writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] } } }))
  const user = fakeSupabase({ tables: { 'projects.reports': reportRows } })
  return { svc, user }
}
const base = (kind: 'feasibility' | 'technical', extra: Partial<Parameters<typeof generateSolarReport>[0]> = {}) => {
  const { svc, user } = setup()
  return { svc, args: { projectId: 'p1', kind, note: 'Rev A', options: { includeLayoutSheet: false, include8760: false }, userId: 'u1', user: user.client as never, svc: svc.client as never, ...extra } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.sel.mockResolvedValue(selOk())
  h.money.mockResolvedValue(new Map([['c1', finRow]]))
  h.brandData.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: null, projectAccent: null, clientLogoDataUri: null, projectName: 'Acme' })
})

describe('generateSolarReport', () => {
  it('refuses a Stale selected case with the reason, writing nothing', async () => {
    h.sel.mockResolvedValue({ ok: false, stale: true, reason: 'The selected case is stale — re-run it first.' })
    const { svc, args } = base('technical')
    await expect(generateSolarReport(args)).resolves.toEqual({ ok: false, error: 'The selected case is stale — re-run it first.' })
    expect(svc.bucket.upload).not.toHaveBeenCalled()
  })
  it('feasibility needs financial results for THIS run', async () => {
    h.money.mockResolvedValue(new Map([['c1', { ...finRow, case_run_id: 'r-old' }]]))
    await expect(generateSolarReport(base('feasibility').args)).resolves.toEqual({ ok: false, error: 'Run financials for the selected case first (Financials tab).' })
  })
  it('technical: stores v1 as solar_technical against the run, with a money-free summary and the neutral-branding warning', async () => {
    const { svc, args } = base('technical')
    const r = await generateSolarReport(args)
    expect(r).toEqual({ ok: true, reportId: 'rep-new', version: 1, warning: expect.stringContaining('neutral template') })
    expect(svc.storageFrom).toHaveBeenCalledWith('reports')
    expect(svc.bucket.upload).toHaveBeenCalledWith('o1/p1/solar-reports/solar_technical-v1-r1.pdf', expect.any(Uint8Array), { contentType: 'application/pdf', upsert: false })
    const ins = callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(ins).toMatchObject({ kind: 'solar_technical', source_table: 'solar.case_runs', source_id: 'r1', version: 1, status: 'issued', note: 'Rev A', generated_by: 'u1' })
    expect(ins.summary).toEqual({ kwp: 500, mwhYear1: 845, runId: 'r1' })
  })
  it('supersedes the previous version of the same kind', async () => {
    const { svc, user } = setup([{ id: 'rep-old', project_id: 'p1', kind: 'solar_feasibility', status: 'issued', version: 3 }])
    const r = await generateSolarReport({ projectId: 'p1', kind: 'feasibility', note: null, options: { includeLayoutSheet: false, include8760: true }, userId: 'u1', user: user.client as never, svc: svc.client as never })
    expect(r).toMatchObject({ ok: true, version: 4 })
    const upd = callsTo(svc.calls, 'projects.reports', 'update')[0]!
    expect(upd.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(upd.filters).toContainEqual(['eq', 'id', 'rep-old'])
  })
  it('layout sheet option: refused for a manual-size case', async () => {
    await expect(generateSolarReport(base('technical', { options: { includeLayoutSheet: true, include8760: false } }).args))
      .resolves.toEqual({ ok: false, error: 'This case uses a manual system size, so there is no layout sheet to attach.' })
  })
  it('layout sheet option: refused when no sheet has been exported', async () => {
    h.sel.mockResolvedValue(selOk('layout'))
    await expect(generateSolarReport(base('technical', { options: { includeLayoutSheet: true, include8760: false } }).args))
      .resolves.toEqual({ ok: false, error: 'Export a layout sheet on the Layout tab first.' })
  })
  it('removes the stored PDF when the row cannot be written', async () => {
    const svc = withStorage(fakeSupabase({ tables: { 'projects.projects': [{ id: 'p1', name: 'Acme' }] }, writes: { 'projects.reports:insert': { error: { message: 'x', code: '23505' } } } }))
    const r = await generateSolarReport({ ...base('technical').args, svc: svc.client as never })
    expect(r).toEqual({ ok: false, error: 'Could not save the report — try again.' })
    expect(svc.bucket.remove).toHaveBeenCalledWith(['o1/p1/solar-reports/solar_technical-v1-r1.pdf'])
  })
})
