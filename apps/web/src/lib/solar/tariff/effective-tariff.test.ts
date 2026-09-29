import { describe, it, expect } from 'vitest'
import { loadEffectiveTariff } from './effective-tariff'
import { fakeSupabase } from '@/test/fake-supabase'

const TARIFF = { id: 't1', tariff_year_id: 'y1', name: 'Commercial', structure: 'flat', category: 'commercial', metering: 'conventional',
  code: null, family: null, voltage_band: null, phase: null, transmission_zone: null, local_authority: false, min_amps: null, max_amps: null,
  min_kva: null, max_kva: null, is_legacy: false, notes: null, source_locator: {}, export_tariff_id: null }
const YEAR = { id: 'y1', licensee_id: 'l1', financial_year: '2025/26', state: 'published' }
const CHARGE = { id: 'c1', tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
  block_basis: null, unit: 'c_per_kWh', demand_basis: null, amount_excl_vat: '250', vat_rate: '0.15', vat_basis: 'stated_excl', unit_inferred: false,
  inference_reason: null, source_locator: {}, extraction_method: 'parser', reviewed_at: null }

/** A select chain that resolves to a PostgREST error (e.g. a timeout or a revoked grant). */
function failingSelect() {
  const r = { data: null, error: { code: '57014', message: 'canceling statement due to statement timeout' } }
  const b: Record<string, unknown> = {}
  for (const k of ['select', 'eq', 'order', 'limit']) b[k] = () => b
  b.maybeSingle = async () => r
  b.then = (res: (v: typeof r) => unknown) => Promise.resolve(r).then(res)
  return b
}

describe('loadEffectiveTariff', () => {
  it('the published tariff when there is no override', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: 't1', tariff_override_id: null, nmd_kva: '500', licensee_id: 'l1' }],
      'tariffs.tariff': [TARIFF], 'tariffs.charge': [CHARGE], 'tariffs.tariff_year': [YEAR],
    } })
    const r = await loadEffectiveTariff(client as never, 'p1', '2026-03-01')
    expect('error' in r).toBe(false)
    if ('error' in r) return
    expect(r.tariff.charges[0].amountExclVat).toBe(250)
    expect(r.overrideId).toBeNull()
    expect(r.nmdKva).toBe(500)
    expect(r.highSeasonMonths).toBeNull()
  })
  it('the override rows when the study carries one', async () => {
    const { client } = fakeSupabase({ tables: {
      'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: 't1', tariff_override_id: 'o1', nmd_kva: null, licensee_id: 'l1' }],
      'tariffs.tariff': [TARIFF], 'tariffs.charge': [CHARGE], 'tariffs.tariff_year': [YEAR],
      'solar.tariff_override_charges': [{ ...CHARGE, id: 'oc1', override_id: 'o1', base_charge_id: 'c1', amount_excl_vat: '199', reason: 'lease', edited_at: 'T', edited_by: 'u', updated_at: 'T' }],
    } })
    const r = await loadEffectiveTariff(client as never, 'p1', '2026-03-01')
    if ('error' in r) throw new Error(r.error)
    expect(r.tariff.charges[0].amountExclVat).toBe(199)
    expect(r.overrideId).toBe('o1')
  })
  it('a failed read is an error, never "missing" and never the unedited published rates', async () => {
    const tables = {
      'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: 't1', tariff_override_id: 'o1', nmd_kva: null, licensee_id: 'l1' }],
      'tariffs.tariff': [TARIFF], 'tariffs.charge': [CHARGE], 'tariffs.tariff_year': [YEAR],
    }
    for (const failing of ['solar.studies', 'tariffs.tariff', 'tariffs.charge', 'tariffs.tariff_year', 'solar.tariff_override_charges', 'solar.study_export_rates', 'solar.org_settings']) {
      const { client } = fakeSupabase({ tables })
      const broken = {
        ...client,
        schema: (s: string) => ({
          from: (t: string) => (`${s}.${t}` === failing ? failingSelect() : client.schema(s).from(t)),
        }),
      }
      expect(await loadEffectiveTariff(broken as never, 'p1', '2026-03-01'), failing)
        .toEqual({ error: 'The tariff could not be loaded. Try again.' })
    }
  })
  it('names what is missing', async () => {
    expect(await loadEffectiveTariff(fakeSupabase({}).client as never, 'p1', '2026-03-01')).toEqual({ error: 'Save Site & Supply first.' })
    const { client } = fakeSupabase({ tables: { 'solar.studies': [{ id: 's1', project_id: 'p1', tariff_id: null }] } })
    expect(await loadEffectiveTariff(client as never, 'p1', '2026-03-01')).toEqual({ error: 'Choose a tariff first.' })
  })
})
