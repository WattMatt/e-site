// @vitest-environment node
/**
 * I-1 through the REAL pricing loader (no mock of ./tariff): each of the four pricing inputs the
 * Tariff and Load tabs store moves the case's current hash, so the case goes Stale; the energy hash
 * (what simulateCase hashes) does not move.
 */
import { describe, it, expect } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { defaultCaseConfig } from '@esite/shared/solar-cases'
import { inputsHash } from '@esite/shared/solar-engine'
import { solarOrgSettingDefaults } from '@esite/shared'
import { loadRunContext } from './run-context'

const P = 'p1', S = 's1', C = 'c1', ORG = 'o1', W = '22222222-2222-4222-8222-222222222222'
const cfg = (() => {
  const c = defaultCaseConfig(solarOrgSettingDefaults(), { dcKwp: 500, acKw: 400 })
  return { ...c, pv: { ...c.pv, module: { equipmentId: '11111111-1111-4111-8111-111111111111', make: 'G', model: 'M', pmaxW: 550, gammaPmaxPctPerC: -0.35 } }, weather: { source: 'pvgis_tmy' as const, datasetId: W } }
})()
const CHARGE = { id: 'c1', tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
  block_basis: null, unit: 'c_per_kWh', demand_basis: null, amount_excl_vat: '250', vat_rate: '0.15', vat_basis: 'stated_excl', unit_inferred: false,
  inference_reason: null, source_locator: {}, extraction_method: 'parser', reviewed_at: null }
const STUDY = { id: S, project_id: P, organisation_id: ORG, latitude: -26.2, longitude: 28.05, export_mode: 'net_billing', export_limit_kw: null, nmd_kva: 500,
  load_basis: 'S1', reference_year: 2024, selected_case_id: null, updated_at: 'T0', tariff_id: 't1', tariff_override_id: null, licensee_id: 'L',
  export_rule: null, escalation: null, load_growth_pct: 0 }
const base = {
  'solar.studies': [STUDY],
  'solar.cases': [{ id: C, study_id: S, project_id: P, name: 'Base', pv_source: 'manual', config: cfg, updated_at: 'T1' }],
  'solar.site_load': [{ study_id: S, basis: 'S1', reference_year: 2024, series: new Array(8760).fill(100) }],
  'solar.weather_datasets': [{ id: W, organisation_id: ORG, source: 'pvgis_tmy', storage_path: 'o1/w.csv.gz', fetched_at: '2026-09-28T00:00:00Z', gsa_pvout_kwh_per_kwp: 1700 }],
  'solar.org_settings': [{ organisation_id: ORG, settings: {} }],
  'solar.tariff_override_charges': [{ ...CHARGE, id: 'oc1', override_id: 'ov1', base_charge_id: 'c1', amount_excl_vat: '300', reason: 'resale', edited_at: 'T', edited_by: 'u', updated_at: 'T' }],
  'solar.study_export_rates': [] as unknown[],
  'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Business Flat', category: 'commercial', metering: 'conventional', structure: 'flat', export_tariff_id: null }],
  'tariffs.charge': [CHARGE],
  'tariffs.tariff_year': [{ id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'published', approved_increase_pct: 12.7 }],
  'tariffs.licensee': [{ id: 'L', name: 'City Power', kind: 'metro' }],
  'tariffs.tou_calendar': [{ id: 'cal', licensee_id: 'L', valid_from: '2020-01-01', valid_to: null, high_season_months: [6, 7, 8], source: 'assumed_eskom' }],
  'tariffs.tou_window': [], 'tariffs.holiday_rule': [], 'tariffs.sseg_rule': [],
}
async function ctx(study: Record<string, unknown> = {}, over: Record<string, unknown[]> = {}) {
  const r = await loadRunContext(fakeSupabase({ tables: { ...base, ...over, 'solar.studies': [{ ...STUDY, ...study }] } as never }).client as never, P, C)
  if (!r.ok) throw new Error(r.error)
  if (!r.ctx.tariff.ok) throw new Error(r.ctx.tariff.reason)
  return r.ctx
}

describe('pricing is part of the case hash (I-1)', () => {
  it('the hash is energy + pricing; the energy hash is what simulateCase hashes', async () => {
    const c = await ctx()
    expect(c.build.ok).toBe(true)
    if (!c.build.ok || !c.tariff.ok) return
    expect(c.energyHash).toBe(inputsHash(c.build.input))
    expect(c.currentHash).toBe(inputsHash({ energy: c.energyHash, pricing: c.tariff.pricingHash }))
  })

  for (const [label, study, over] of [
    ['a project override', { tariff_override_id: 'ov1' }, {}],
    ['a manual export rule with its rate', { export_rule: { version: 1, method: 'manual' } },
      { 'solar.study_export_rates': [{ id: 'r1', study_id: S, season: 'all', tou: 'all', unit: 'R_per_kWh', amount_excl_vat: '0.85', source_note: 'note' }] }],
    ['(d) an escalation path change on the Tariff tab', { escalation: { version: 1, overrides: { 4: 20 } } }, {}],
    ['load growth on the Load tab', { load_growth_pct: 3 }, {}],
  ] as const) {
    it(`${label} marks the case Stale (hash moves) without touching the energy hash`, async () => {
      const a = await ctx(), b = await ctx(study, over as Record<string, unknown[]>)
      expect(b.energyHash).toBe(a.energyHash)
      expect(b.currentHash).not.toBe(a.currentHash)
    })
  }
})
