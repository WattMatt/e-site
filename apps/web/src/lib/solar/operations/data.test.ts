import { describe, it, expect, vi, beforeEach } from 'vitest'
const h = vi.hoisted(() => ({ tariff: vi.fn() }))
vi.mock('@/lib/solar/cases/tariff', () => ({ resolveStudyTariff: h.tariff }))

import { fakeSupabase } from '@/test/fake-supabase'
import { loadOperationsReadiness, loadOperationsView } from './data'
import { INSTALL_REASONS } from './baseline-loader'

const baseline = {
  version: 1, caseRunId: 'run-1', inputsHash: 'a'.repeat(64), dcKwp: 100, acKw: 80, performanceRatio: 0.8,
  monthlyKwh: new Array(12).fill(1000),
  diurnalKw: Array.from({ length: 12 }, () => Array.from({ length: 24 }, (_, hh) => (hh >= 8 && hh < 16 ? 5 : 0))),
  ghiKwhM2: null,
}
const asBuilt = { dcKwp: 100, acKw: 80, batteryKwh: null, batteryKw: null, tiltDeg: 15, azimuthDeg: 0,
  equipment: [{ kind: 'module', make: 'A', model: 'M', rating: 500, unit: 'W', quantity: 200 }, { kind: 'inverter', make: 'V', model: 'I', rating: 80, unit: 'kW', quantity: 1 }] }
const at = (iso: string) => Date.parse(iso)
// 10 March: zero output 11:30–13:00 SAST (three 30-min intervals), else 40 kW in daylight.
const points = Array.from({ length: 48 }, (_, k) => {
  const end = at('2026-03-10T00:30:00+02:00') + k * 1_800_000
  const hhmm = new Date(end + 7_200_000).toISOString().slice(11, 16)
  const prod = hhmm >= '06:30' && hhmm <= '18:30' && !['12:00', '12:30', '13:00'].includes(hhmm)
  return [end, prod ? 40 : 0, 30]
})

function user(over: Record<string, unknown[]> = {}) {
  return fakeSupabase({
    tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', organisation_id: 'o1', latitude: -25.75, longitude: 28.19, elevation_m: 1339 }],
      'solar.installations': [{ id: 'i1', study_id: 's1', commissioning_date: '2026-02-15', baseline, as_built: asBuilt, notes: null, updated_at: 'T1' }],
      'solar.installation_meters': [{ installation_id: 'i1', meter_id: 'm1', role: 'generation', expected_share_pct: null }],
      'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }, { study_id: 's1', meter_id: 'm2' }, { study_id: 's1', meter_id: 'm3' }],
      'solar.meters': [{ id: 'm1', label: 'PV main', kind: 'solar' }, { id: 'm2', label: 'Council', kind: 'council' }, { id: 'm3', label: 'Shop 1', kind: 'tenant' }],
      'solar.guarantees': [{ installation_id: 'i1', basis: 'p50', pct: null, manual_monthly_kwh: null, degradation_pct_per_year: '0', updated_at: 'G1' }],
      'solar.ops_irradiation': [],
      'solar.downtime': [],
      'solar.handover_items': [{ id: 'h1', installation_id: 'i1', item_key: 'coc', label: 'CoC', required: true, sort_order: 0, document_id: 'd1', not_applicable: false, note: null, completed_at: 'C1', updated_at: 'U1' }],
      'solar.handover_templates': [],
      'solar.monthly_report_notes': [{ installation_id: 'i1', period_month: '2026-03-01', section: 'summary', body: 'Good', updated_at: 'N1' }],
      'tenants.documents': [{ id: 'd1', project_id: 'p1', name: 'CoC.pdf' }],
      ...over,
    },
    rpc: {
      solar_ops_monthly_kwh: (args) => ({ data: args.p_role === 'generation' ? { m1: { '2026-03': { kwh: 900, n: 1488, intervalMin: 30 } } } : {}, error: null }),
      solar_ops_series: { data: { points }, error: null },
    },
  })
}
const svc = (props: unknown[] = []) => fakeSupabase({ tables: { 'solar.proposals': props as never } })

beforeEach(() => { vi.clearAllMocks(); h.tariff.mockResolvedValue({ ok: false, reason: 'No tariff is pinned for this study — pin one on the Tariff tab.' }) })

describe('loadOperationsView', () => {
  it('no study: says why and loads nothing else', async () => {
    const v = await loadOperationsView({ user: user({ 'solar.studies': [] }).client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(v).toMatchObject({ installation: null, setupReason: INSTALL_REASONS.noStudy, readiness: null })
  })
  it('no installation: offers the accepted proposal, or says there is none', async () => {
    const u = user({ 'solar.installations': [] })
    const a = await loadOperationsView({ user: u.client as never, svc: svc([{ id: 'prop-1', version: 3, case_run_id: 'r', study_id: 's1', status: 'accepted' }]).client as never, projectId: 'p1', level: 'edit', month: null })
    expect(a).toMatchObject({ installation: null, acceptedProposal: { id: 'prop-1', version: 3 }, setupReason: null })
    const b = await loadOperationsView({ user: u.client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(b).toMatchObject({ acceptedProposal: null, setupReason: INSTALL_REASONS.noAccepted })
  })
  it('installed: performance from the aggregation, available meters exclude linked and non-generation kinds, candidates for an editor', async () => {
    const v = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    expect(v.months).toEqual(['2026-03'])
    expect(v.selectedMonth).toBe('2026-03')
    expect(v.performance.map((r) => [r.month, r.actualKwh])).toEqual([['2026-02', null], ['2026-03', 900]])
    expect(v.meters).toEqual([{ meterId: 'm1', label: 'PV main', kind: 'solar', role: 'generation', sharePct: null }])
    expect(v.availableMeters).toEqual([{ meterId: 'm2', label: 'Council', kind: 'council' }])
    expect(v.candidates).toEqual([{ startsAt: '2026-03-10T09:30:00.000Z', endsAt: '2026-03-10T11:00:00.000Z', intervals: 3, hours: 1.5 }])
    expect(v.handover.items[0]).toMatchObject({ key: 'coc', documentName: 'CoC.pdf' })
    expect(v.handover.completion).toMatchObject({ done: 1, total: 1, pct: 100 })
    expect(v.handover.templateName).toBe('Solar PV Handover')
    expect(v.monthly).toBeNull()
    expect(v.readiness).toEqual({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 1 })
  })
  it('a View user gets no candidates; a money user gets notes and the reason Generate is disabled', async () => {
    const view = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'view', month: null })
    expect(view.candidates).toEqual([])
    const money = await loadOperationsView({ user: user().client as never, svc: svc().client as never, projectId: 'p1', level: 'edit_financials', month: '2026-03' })
    expect(money.monthly).toMatchObject({ generateReason: 'No tariff is pinned for this study — pin one on the Tariff tab.', tariffName: null })
    expect(money.monthly!.notes.summary).toBe('Good')
    expect(money.monthly!.notesUpdatedAt.summary).toBe('N1')
    expect(h.tariff).toHaveBeenCalledWith(expect.anything(), 'p1', expect.objectContaining({ year: 2026 }))
  })
  it('lost kWh is computed for downtime in the selected month', async () => {
    const dt = [{ id: 'd1', installation_id: 'i1', starts_at: '2026-03-10T09:30:00.000Z', ends_at: '2026-03-10T11:00:00.000Z', cause: 'inverter_fault',
      description: null, excluded_from_guarantee: false, source: 'detected', updated_at: 'D1' }]
    const v = await loadOperationsView({ user: user({ 'solar.downtime': dt }).client as never, svc: svc().client as never, projectId: 'p1', level: 'edit', month: null })
    // 1.5 h of an 8-producing-hour day in a 31-day month of 1000 kWh, all lost.
    expect(v.downtime[0]!.lostKwh).toBeCloseTo(1000 * 1.5 / (8 * 31), 3)
    expect(v.candidates).toEqual([])
  })
})

describe('loadOperationsReadiness', () => {
  it('null without an installation; otherwise the date and the months with data', async () => {
    await expect(loadOperationsReadiness(user({ 'solar.installations': [] }).client as never, 'p1')).resolves.toBeNull()
    await expect(loadOperationsReadiness(user().client as never, 'p1')).resolves.toEqual({ installed: true, commissioningDate: '2026-02-15', monthsWithData: 1 })
  })
})
