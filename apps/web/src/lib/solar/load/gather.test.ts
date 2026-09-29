import { describe, it, expect } from 'vitest'
import { fakeSupabase, type FakeOptions } from '@/test/fake-supabase'
import { gatherLoadInputs, mergeChannelData, pickChannels, type ChannelRow } from './gather'

const P = 'p1'
const ch = (id: string, over: Partial<ChannelRow> = {}): ChannelRow => ({
  id, meter_id: 'm1', file_id: 'f1', source_column: 'p14', quantity: 'active_power', direction: 'import', unit: 'kW',
  interval_min: 30, is_primary: true, coverage_only: false, updated_at: '2025-01-01T00:00:00Z', ...over,
})
function tables(over: Record<string, Array<Record<string, unknown>>> = {}): FakeOptions {
  return {
    tables: {
      'solar.studies': [{ id: 's1', project_id: P, load_basis: 'S2', reference_year: null, common_area_pct: '10.00', diversity_factor: '1.000', load_growth_pct: '0', monthly_bills: null, schematic_waived: false, updated_at: 'T0' }],
      'projects.projects': [{ id: P, opening_date: '2026-06-01' }],
      'structure.nodes': [
        { id: 'n1', project_id: P, kind: 'tenant_db', code: 'T1', name: null, shop_number: '12', shop_name: 'Pep', shop_area_m2: '120', shop_category: 'standard', status: 'active' },
        { id: 'n2', project_id: P, kind: 'tenant_db', code: 'T2', name: 'Old', shop_number: '13', shop_name: null, shop_area_m2: null, shop_category: null, status: 'decommissioned' },
      ],
      'structure.tenant_details': [{ node_id: 'n1', bo_period_days: 30, bo_date_override: null }],
      'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 1 }], archetype: null, density_override_w_m2: null, updated_at: 'T1' }],
      'solar.study_meters': [{ study_id: 's1', meter_id: 'm1' }],
      'solar.meters': [{ id: 'm1', label: 'Pep meter', kind: 'tenant', site_label: 'YA', serials: ['S1'], supply_point_confirmed: false, existing_pv_channel_id: null, node_id: 'n1', shop_no: '12', area_m2: null, area_source: null, updated_at: 'T2' }],
      'solar.meter_channels': [{ ...ch('c1') }],
      'solar.schematic_lines': [],
      ...over,
    },
    rpc: {
      'solar.channel_summaries': { data: [{ channel: 'c1', first_ts: '2025-01-01T00:30:00Z', last_ts: '2025-12-31T22:00:00Z', n_rows: 3, n_usable: 3, max_value: 5, sum_value: 9 }], error: null },
      'solar.channel_readings': { data: [{ channel: 'c1', ts_ends: ['2025-03-10T00:30:00Z'], vals: [2], quals: [0] }], error: null },
    },
  }
}

describe('pickChannels / mergeChannelData', () => {
  it('takes every primary kW channel at the newest interval, kVA at that interval, and the PV channel', () => {
    const chans = [
      ch('old', { updated_at: '2024-01-01T00:00:00Z' }), ch('new', { updated_at: '2025-06-01T00:00:00Z' }),
      ch('daily', { interval_min: 1440 }), ch('kva', { is_primary: false, quantity: 'apparent_power', unit: 'kVA' }),
      ch('pv', { meter_id: 'm9', is_primary: false }),
    ]
    const p = pickChannels({ id: 'm1', existing_pv_channel_id: 'pv' }, chans)
    expect(p.primary.map((c) => c.id)).toEqual(['new', 'old'])
    expect(p.kva.map((c) => c.id)).toEqual(['kva'])
    expect(p.pv?.id).toBe('pv')
  })
  it('merges files with the newer one winning a shared timestamp', () => {
    const m = mergeChannelData([ch('new'), ch('old')], new Map([
      ['old', [{ tsEnd: 1, value: 1, quality: 0 as const }, { tsEnd: 2, value: 1, quality: 0 as const }]],
      ['new', [{ tsEnd: 2, value: 9, quality: 0 as const }]],
    ]))
    expect(m).toEqual({ intervalMin: 30, readings: [{ tsEnd: 1, value: 1, quality: 0 }, { tsEnd: 2, value: 9, quality: 0 }] })
  })
})

describe('gatherLoadInputs', () => {
  it('builds tenants (active only, BO date computed), meters and settings', async () => {
    const { client } = fakeSupabase(tables())
    const g = await gatherLoadInputs(client as never, P, { readReadings: true, now: new Date('2026-09-28T00:00:00Z') })
    if (!g.ok) throw new Error('expected ok')
    expect(g.input.tenants).toEqual([{
      nodeId: 'n1', label: '12 · Pep', areaM2: 120, category: 'standard', source: 'metered', meters: [{ meterId: 'm1', weight: 1 }],
      archetype: null, densityOverrideWPerM2: null, boDate: '2026-05-02',
    }])
    expect(g.input).toMatchObject({ basis: 'S2', referenceYear: null, fallbackYear: 2025, commonAreaPct: 10, diversityFactor: 1 })
    expect(g.input.meters[0].primary?.readings).toHaveLength(1)
    expect(g.inputsHash).toMatch(/^[0-9a-f]{64}$/)
    // The counts of exactly the sets the hash covers (every study-meter link, every project line, every basis row).
    expect(g.inputCounts).toEqual({ studyMeters: 1, schematicLines: 0, basisRows: 1 })
  })
  it('does not read readings when asked not to, and the hash does not depend on them', async () => {
    const a = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: false })
    const b = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: true })
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.input.meters[0].primary?.readings).toEqual([])
    expect(a.inputsHash).toBe(b.inputsHash)
  })
  it('the hash changes when a weight changes', async () => {
    const a = await gatherLoadInputs(fakeSupabase(tables()).client as never, P, { readReadings: false })
    const b = await gatherLoadInputs(fakeSupabase(tables({
      'solar.tenant_load_basis': [{ id: 'b1', study_id: 's1', node_id: 'n1', source: 'metered', meters: [{ meter_id: 'm1', weight: 0.5 }], archetype: null, density_override_w_m2: null, updated_at: 'T1' }],
    })).client as never, P, { readReadings: false })
    if (!a.ok || !b.ok) throw new Error('expected ok')
    expect(a.inputsHash).not.toBe(b.inputsHash)
  })
  it('reports no_study', async () => {
    const g = await gatherLoadInputs(fakeSupabase(tables({ 'solar.studies': [] })).client as never, P, { readReadings: false })
    expect(g).toEqual({ ok: false, error: 'no_study' })
  })
})
