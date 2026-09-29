import { describe, it, expect, vi, beforeEach } from 'vitest'
import { HOURS_PER_YEAR } from '@esite/shared/solar-load'

const h = vi.hoisted(() => ({ gather: vi.fn(), sums: vi.fn() }))
vi.mock('./gather', async (orig) => ({ ...(await orig<object>()), gatherLoadInputs: h.gather }))
vi.mock('./readings', () => ({ channelSummaries: h.sums, readChannelReadings: vi.fn() }))

import { fakeSupabase } from '@/test/fake-supabase'
import { loadChecksView, loadLoadReadiness, loadMetersView, loadProfileView, loadTenantsView } from './views'

const P = 'p1'
const CH = { id: 'c1', meter_id: 'm1', file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW', interval_min: 30, is_primary: true, coverage_only: false, updated_at: 't' }
const tables = {
  'projects.projects': [{ id: P, organisation_id: 'o1', cloud_storage_connection_id: 'c', cloud_storage_folder_id: 'f' }],
  'solar.studies': [{ id: 's1', project_id: P, load_basis: 'S2', reference_year: null, common_area_pct: '5', diversity_factor: '1', load_growth_pct: '0', monthly_bills: null, schematic_waived: false, updated_at: 'T0' }],
  'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }],
  'solar.meters': [{ id: 'm1', label: 'Pep', kind: 'tenant', site_label: 'YA', serials: [], supply_point_confirmed: false, existing_pv_channel_id: null, node_id: 'n1', shop_no: '12', area_m2: null, area_source: null, updated_at: 'M0' }],
  'solar.meter_channels': [CH],
  'structure.nodes': [
    { id: 'n1', project_id: P, kind: 'tenant_db', code: 'T1', name: null, shop_number: '12', shop_name: 'Pep', shop_area_m2: '100', shop_category: 'standard', status: 'active' },
    { id: 'n2', project_id: P, kind: 'tenant_db', code: 'T2', name: null, shop_number: '13', shop_name: 'VACANT', shop_area_m2: '50', shop_category: null, status: 'active' },
  ],
  'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }], archetype: null, density_override_w_m2: null, updated_at: 'B0' }],
  'solar.meter_register': [
    { id: 'r1', organisation_id: 'o1', kind: 'summary', site_label: 'YA', file_name: 'Pep.csv', tenant_name: 'Pep', shop_no: '12', area_m2: 100, match_method: 'llm', confirmed_at: null },
    { id: 'r2', organisation_id: 'o1', kind: 'summary', site_label: 'YA', file_name: 'Missing.csv', tenant_name: 'X', shop_no: '99', area_m2: null, match_method: 'exact', confirmed_at: null },
  ],
  'solar.meter_files': [{ id: 'f1', organisation_id: 'o1', original_name: 'Pep.csv' }],
  'solar.site_load': [{ id: 'sl', study_id: 's1', basis: 'S2', reference_year: 2025, series: Array(HOURS_PER_YEAR).fill(1), md_monthly: [], inputs_hash: 'h1', built_at: '2025-09-01T00:00:00Z',
    coverage: { metered: 1, unassigned: 1, fullYearFromData: true, designMdKw: null, checks: [{ key: 'k1', severity: 'warning', message: 'm' }], reconciliation: { bulk: [], parents: [] }, tenants: [{ nodeId: 'n1', source: 'metered', annualKwh: 8760, peakKw: 1, wPerM2: 10 }] } }],
  'solar.load_check_acks': [{ study_id: 's1', check_key: 'k1', note: 'ok', acknowledged_at: '2025-09-02T00:00:00Z' }],
  'solar.schematics': [],
  'solar.schematic_cards': [],
  'solar.meter_import_reports': [],
}
beforeEach(() => {
  vi.clearAllMocks()
  h.sums.mockResolvedValue(new Map([['c1', { channelId: 'c1', firstTs: Date.parse('2025-01-01T00:30:00Z'), lastTs: Date.parse('2025-12-31T23:00:00Z'), nRows: 17520, nUsable: 17000, maxValue: 12, sumValue: 175200 }]]))
  h.gather.mockResolvedValue({ ok: true, inputsHash: 'h2' })
})
const client = () => fakeSupabase({ tables }).client as never

describe('load views', () => {
  it('meters view: summaries, tenant label, register flags', async () => {
    const v = await loadMetersView(client(), P, false)
    expect(v.meters[0]).toMatchObject({ id: 'm1', tenantLabel: '12 · Pep', intervalMin: 30, peakKw: 12, status: 'imported', fileIds: ['f1'] })
    expect(v.meters[0].annualKwh).toBeCloseTo(87_600, -2)
    expect(v.meters[0].completeness).toBeCloseTo(17000 / 17520, 2)
    expect(v.register.find((r) => r.id === 'r2')?.fileImported).toBe(false)
    expect(v.cloudMapped).toBe(true)
  })
  it('tenants view: basis, last-build summary, vacant flag, and never pre-ticks an LLM register match', async () => {
    const v = await loadTenantsView(client(), P)
    expect(v.tenants.find((t) => t.nodeId === 'n1')?.summary).toMatchObject({ annualKwh: 8760 })
    expect(v.tenants.find((t) => t.nodeId === 'n2')?.vacant).toBe(true)
    expect(v.proposals.every((p) => p.meterId !== 'm1')).toBe(true) // m1 is already assigned
  })
  it('profile view: charts from the stored series and stale when the hash moved', async () => {
    const v = await loadProfileView(client(), P)
    expect(v.siteLoad?.stale).toBe(true)
    expect(v.siteLoad?.charts.kpis.annualKwh).toBeCloseTo(8760)
    expect(v.years).toEqual([2025])
  })
  it('checks view: acknowledged rows carry the note', async () => {
    const v = await loadChecksView(client(), P)
    expect(v.checks[0]).toMatchObject({ key: 'k1', ack: { note: 'ok' } })
  })
  it('readiness aggregate: counts unassigned tenants from the current rows', async () => {
    const r = await loadLoadReadiness(client(), P)
    expect(r).toMatchObject({ load: { hasSiteLoad: true, unassignedTenants: 1, totalTenants: 2, basis: 'S2' } })
  })
  // The dot's CHEAP signal: every input row carries a timestamp before the build (2025-09-01) here.
  const BEFORE = '2025-08-01T00:00:00Z'
  const AFTER = '2025-09-02T00:00:00Z'
  const freshTables = () => ({
    ...tables,
    'solar.studies': [{ ...tables['solar.studies'][0], updated_at: BEFORE }],
    'solar.study_meters': [{ study_id: 's1', meter_id: 'm1', added_at: BEFORE }],
    'solar.meters': [{ ...tables['solar.meters'][0], updated_at: BEFORE }],
    'solar.meter_channels': [{ ...CH, updated_at: BEFORE }],
    'structure.nodes': tables['structure.nodes'].map((n) => ({ ...n, updated_at: BEFORE })),
    'structure.tenant_details': [{ node_id: 'n1', updated_at: BEFORE }],
    'solar.tenant_load_basis': [
      { ...tables['solar.tenant_load_basis'][0], updated_at: BEFORE },
      { id: 'b2', study_id: 's1', node_id: 'n2', source: 'vacant', meters: [], archetype: null, density_override_w_m2: null, updated_at: BEFORE },
    ],
    'solar.schematic_lines': [{ id: 'l1', project_id: P, updated_at: BEFORE }],
    'solar.meter_import_reports': [{ file_id: 'f1', accepted_at: BEFORE, created_at: BEFORE }],
  })
  it('readiness dot: fresh when no input row changed after the build, and it never reads channel summaries or gathers', async () => {
    const { client: c, calls } = fakeSupabase({ tables: freshTables() })
    const r = await loadLoadReadiness(c as never, P)
    expect(r.load?.stale).toBe(false)
    expect(h.gather).not.toHaveBeenCalled()
    expect(h.sums).not.toHaveBeenCalled()
    expect(c.rpc).not.toHaveBeenCalled()
    expect(calls.some((x) => x.table === 'solar.meter_readings')).toBe(false)
  })
  it.each([
    ['the study settings', (t: ReturnType<typeof freshTables>) => { t['solar.studies'][0].updated_at = AFTER }],
    ['a tenant basis', (t: ReturnType<typeof freshTables>) => { t['solar.tenant_load_basis'][1].updated_at = AFTER }],
    ['a meter linked to the study', (t: ReturnType<typeof freshTables>) => { t['solar.study_meters'][0].added_at = AFTER }],
    ['a study meter', (t: ReturnType<typeof freshTables>) => { t['solar.meters'][0].updated_at = AFTER }],
    ['a study meter channel', (t: ReturnType<typeof freshTables>) => { t['solar.meter_channels'][0].updated_at = AFTER }],
    ['an import accepted into a study meter file', (t: ReturnType<typeof freshTables>) => { t['solar.meter_import_reports'][0].accepted_at = AFTER }],
    ['a schematic supply line', (t: ReturnType<typeof freshTables>) => { t['solar.schematic_lines'][0].updated_at = AFTER }],
    ['a tenant node (area, category, soft-delete)', (t: ReturnType<typeof freshTables>) => { t['structure.nodes'][1].updated_at = AFTER }],
    ['a tenant BO date', (t: ReturnType<typeof freshTables>) => { t['structure.tenant_details'][0].updated_at = AFTER }],
  ])('readiness dot: stale when %s changed after the build', async (_label, mutate) => {
    const t = freshTables()
    mutate(t)
    const r = await loadLoadReadiness(fakeSupabase({ tables: t }).client as never, P)
    expect(r.load?.stale).toBe(true)
  })
  it('readiness resolves (not stale) when a staleness query throws, and logs it server-side', async () => {
    const { client: c } = fakeSupabase({ tables: freshTables() })
    const orig = c.schema
    c.schema = ((s: string) => (s === 'solar'
      ? { ...orig(s), from: (t: string) => { if (t === 'meter_channels' || t === 'schematic_lines') throw new Error('statement timeout'); return orig(s).from(t) } }
      : orig(s))) as typeof c.schema
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const r = await loadLoadReadiness(c as never, P)
    expect(r.load).not.toBeNull()
    expect(r.load?.stale).toBe(false)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
  it('the Site profile banner keeps the full hash check, and a failing gather does not take the page down', async () => {
    h.gather.mockRejectedValue(new Error('channel_summaries: 22023 too many channels'))
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    const v = await loadProfileView(client(), P)
    expect(v.siteLoad?.stale).toBe(false)
    expect(err).toHaveBeenCalled()
    err.mockRestore()
    h.gather.mockResolvedValue({ ok: true, inputsHash: 'h2' })
    expect((await loadProfileView(client(), P)).siteLoad?.stale).toBe(true)
    expect(h.gather).toHaveBeenLastCalledWith(expect.anything(), P, { readReadings: false })
  })
  it('readiness skips the staleness gather when an earlier rule already holds the dot amber', async () => {
    const r = await loadLoadReadiness(client(), P) // S2 with one unassigned tenant
    expect(r.load?.unassignedTenants).toBe(1)
    expect(h.gather).not.toHaveBeenCalled()
  })
})
