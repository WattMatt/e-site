import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ view: vi.fn(), series: vi.fn(), months: vi.fn(), value: vi.fn(), brand: vi.fn(), render: vi.fn(async () => Buffer.from('%PDF-monthly')) }))
vi.mock('./data', () => ({ loadOperationsView: h.view }))
vi.mock('./series', () => ({ loadMonthSeries: h.series, loadMeterMonths: h.months }))
vi.mock('./lost-revenue', () => ({ valueLostEnergy: h.value }))
vi.mock('@/lib/solar/reports/branding-loader', () => ({ loadSolarBrandingData: h.brand }))
vi.mock('./render-monthly', () => ({ renderMonthlyReport: h.render }))

import { generateMonthlyReport, MONTHLY_ERRORS } from './monthly-report'
import { fakeSupabase, callsTo } from '@/test/fake-supabase'
import { withStorage } from '@/test/fake-storage'

const baseline = { version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000), diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, x) => (x >= 10 && x < 14 ? 5 : 0))), ghiKwhM2: null }
const perfRow = (month: string, actual: number | null) => ({ month, operatingYear: 1, expectedKwh: 1000, excludedKwh: 0, guaranteeKwh: 1000, actualKwh: actual,
  varianceKwh: actual === null ? null : actual - 1000, variancePct: actual === null ? null : (actual - 1000) / 10, performanceRatio: null, correctedExpectedKwh: null,
  irradiationPlane: null, downtimeHours: 0, excludedHours: 0, coveragePct: 100 })
const view = (over: Record<string, unknown> = {}) => ({
  level: 'edit_financials', canEdit: true, canSeeMoney: true, studyId: 's1', organisationId: 'o1', setupReason: null, acceptedProposal: null,
  installation: { id: 'i1', commissioningDate: '2026-01-10', notes: null, updatedAt: 'T', baseline,
    asBuilt: { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0, equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }, { kind: 'inverter', make: 'V', model: 'I', rating: 80, unit: 'kW', quantity: 1 }] } },
  meters: [{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation', sharePct: null }, { meterId: 'm2', label: 'Council', kind: 'council', role: 'consumption', sharePct: null }],
  availableMeters: [], guarantee: { basis: 'p50', pct: null, manualMonthlyKwh: null, degradationPctPerYear: 0, updatedAt: 'G' }, irradiation: [],
  downtime: [{ id: 'd1', startsAt: '2026-03-10T09:00:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault', description: null, excludedFromGuarantee: false, source: 'manual', updatedAt: 'D', lostKwh: 16 }],
  months: ['2026-01', '2026-02', '2026-03'], selectedMonth: '2026-03',
  performance: [perfRow('2026-01', 700), perfRow('2026-02', 950), perfRow('2026-03', 900)],
  candidates: [], handover: { items: [], completion: { done: 0, total: 0, pct: 0, requiredDone: 0, requiredTotal: 0 }, documents: [], templateName: 'x' },
  monthly: { notes: { summary: 'Good', performance: '', downtime: '', financial: '', actions: '' }, notesUpdatedAt: {}, generateReason: null, tariffName: 'Business 1' },
  readiness: null, ...over,
})

function setup(prior: Array<Record<string, unknown>> = [], writes: Record<string, unknown> = {}) {
  const svc = withStorage(fakeSupabase({ tables: { 'solar.monthly_reports': prior, 'projects.projects': [{ id: 'p1', name: 'Acme Mall' }] },
    writes: { 'projects.reports:insert': { data: [{ id: 'rep-new' }] }, 'solar.monthly_reports:insert': { data: [{ id: 'mr-new' }] }, ...writes } as never }))
  return { svc, args: { projectId: 'p1', month: '2026-03', note: 'Rev A', userId: 'u1', user: fakeSupabase().client as never, svc: svc.client as never } }
}

beforeEach(() => {
  vi.clearAllMocks()
  h.view.mockResolvedValue(view())
  h.series.mockResolvedValue([])
  h.months.mockImplementation(async (_c: unknown, _i: string, role: string) => role === 'consumption'
    ? { m2: { '2026-03': { kwh: 12000, n: 1488, intervalMin: 30 } } } : { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } })
  h.value.mockResolvedValue({ ok: true, tariffName: 'Business 1 (City of Tshwane, 2026/27)', perEventZar: [42.5], totalZar: 42.5 })
  h.brand.mockResolvedValue({ orgName: 'Sun Co', orgLogoDataUri: null, orgAccent: '#0055AA', projectAccent: null, clientLogoDataUri: null, projectName: 'Acme Mall' })
})

describe('generateMonthlyReport', () => {
  it('stores v1: PDF, a projects.reports row (solar_monthly, per-period version) and the frozen snapshot', async () => {
    const { svc, args } = setup()
    const r = await generateMonthlyReport(args)
    expect(r).toMatchObject({ ok: true, reportId: 'rep-new', version: 1 })
    const up = (svc.bucket.upload as ReturnType<typeof vi.fn>).mock.calls[0] as unknown as [string, Uint8Array, unknown]
    // Under solar-reports/ so 00216's service-only storage + row policies cover the file (deviation from the plan's solar-monthly/).
    expect(up[0]).toMatch(/^o1\/p1\/solar-reports\/solar_monthly-2026-03-v1-[0-9a-f]{12}\.pdf$/)
    const rep = callsTo(svc.calls, 'projects.reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(rep).toMatchObject({ kind: 'solar_monthly', source_table: 'solar.installations', source_id: 'i1', version: 1, status: 'issued', note: 'Rev A', generated_by: 'u1',
      summary: { period: '2026-03', actualKwh: 900, guaranteeKwh: 1000, variancePct: -10 } })
    const mr = callsTo(svc.calls, 'solar.monthly_reports', 'insert')[0]!.payload as Record<string, unknown>
    expect(mr).toMatchObject({ installation_id: 'i1', period_month: '2026-03-01', version: 1, report_id: 'rep-new', generated_by: 'u1' })
    const snap = mr.snapshot as { ytd: { actualKwh: number }; lost: { zar: number }; consumption: { gridKwh: number }; notes: { summary: string } }
    expect(snap.ytd.actualKwh).toBe(2550)
    expect(snap.lost.zar).toBe(42.5)
    expect(snap.consumption.gridKwh).toBe(12000)
    expect(snap.notes.summary).toBe('Good')
    expect(mr.snapshot_sha256).toMatch(/^[0-9a-f]{64}$/)
    expect(mr.pdf_sha256).toMatch(/^[0-9a-f]{64}$/)
  })
  it('v2 supersedes v1’s report row and never touches v1’s snapshot', async () => {
    const { svc, args } = setup([{ installation_id: 'i1', period_month: '2026-03-01', version: 1, report_id: 'rep-1' }])
    await expect(generateMonthlyReport(args)).resolves.toMatchObject({ ok: true, version: 2 })
    expect(callsTo(svc.calls, 'solar.monthly_reports', 'update')).toHaveLength(0)
    const upd = callsTo(svc.calls, 'projects.reports', 'update')[0]!
    expect(upd.payload).toEqual({ status: 'superseded', superseded_by: 'rep-new' })
    expect(upd.filters).toContainEqual(['eq', 'id', 'rep-1'])
  })
  it('refuses with the view’s reason, or when the month has no data', async () => {
    h.view.mockResolvedValue(view({ monthly: { ...view().monthly, generateReason: 'No tariff is pinned for this study — pin one on the Tariff tab.' } }))
    await expect(generateMonthlyReport(setup().args)).resolves.toEqual({ ok: false, error: 'No tariff is pinned for this study — pin one on the Tariff tab.' })
    h.view.mockResolvedValue(view({ selectedMonth: '2026-02' }))
    await expect(generateMonthlyReport(setup().args)).resolves.toEqual({ ok: false, error: 'There is no generation data for March 2026.' })
  })
  it('a month before the commissioning month says so, not "no generation data" (review B7)', async () => {
    // March has data, but the plant was commissioned in April: the view has no performance row for March.
    h.view.mockResolvedValue(view({ installation: { ...view().installation, commissioningDate: '2026-04-02' }, performance: [] }))
    await expect(generateMonthlyReport(setup().args)).resolves.toEqual({ ok: false, error: 'March 2026 is before the commissioning month (April 2026).' })
  })
  it('a concurrent generation loses cleanly: the report row and the PDF are removed', async () => {
    const { svc, args } = setup([], { 'solar.monthly_reports:insert': { error: { code: '23505', message: 'solar.monthly_reports: version 1 is not the next version' } } })
    await expect(generateMonthlyReport(args)).resolves.toEqual({ ok: false, error: MONTHLY_ERRORS.race })
    expect(callsTo(svc.calls, 'projects.reports', 'delete')[0]!.filters).toContainEqual(['eq', 'id', 'rep-new'])
    expect(svc.bucket.remove).toHaveBeenCalled()
  })
})
