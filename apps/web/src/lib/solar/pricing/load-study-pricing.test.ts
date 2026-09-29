// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'
import { fakeSupabase } from '@/test/fake-supabase'
import { runBillCheck } from '@esite/shared'
import { loadStudyPricing } from './load-study-pricing'
import { loadEffectiveTariff } from '../tariff/effective-tariff'
import { resolveStudyTariff } from '../cases/tariff'

const P = 'p1'
const CHARGE = { id: 'c1', tariff_id: 't1', component: 'energy', season: 'all', tou: 'all', day_type: 'all', block_min_kwh: null, block_max_kwh: null,
  block_basis: null, unit: 'c_per_kWh', demand_basis: null, amount_excl_vat: '250', vat_rate: '0.15', vat_basis: 'stated_excl', unit_inferred: false,
  inference_reason: null, source_locator: {}, extraction_method: 'parser', reviewed_at: null }
const BASIC = { ...CHARGE, id: 'c2', component: 'basic', unit: 'R_per_month', amount_excl_vat: '500' }

const tables = (study: Record<string, unknown> = {}) => ({
  'solar.studies': [{ id: 's1', project_id: P, organisation_id: 'o1', tariff_id: 't1', tariff_override_id: 'ov1', nmd_kva: null, licensee_id: 'L',
    export_rule: { version: 1, method: 'manual' }, escalation: { version: 1, overrides: { 3: 4.5 } }, load_growth_pct: '3', ...study }],
  'solar.tariff_override_charges': [
    { ...CHARGE, id: 'oc1', override_id: 'ov1', base_charge_id: 'c1', amount_excl_vat: '300', reason: 'Landlord resale mark-up', edited_at: 'T', edited_by: 'u', updated_at: 'T' },
    { ...BASIC, id: 'oc2', override_id: 'ov1', base_charge_id: 'c2', reason: null, edited_at: null, edited_by: null, updated_at: 'T' },
  ],
  'solar.study_export_rates': [{ id: 'r1', study_id: 's1', season: 'all', tou: 'all', unit: 'R_per_kWh', amount_excl_vat: '0.85', source_note: 'City SSEG schedule p4' }],
  'solar.org_settings': [{ organisation_id: 'o1', settings: {} }],
  'tariffs.tariff': [{ id: 't1', tariff_year_id: 'y1', name: 'Business Flat', category: 'commercial', metering: 'conventional', structure: 'flat', export_tariff_id: null }],
  'tariffs.charge': [CHARGE, BASIC],
  'tariffs.tariff_year': [
    { id: 'y1', licensee_id: 'L', financial_year: '2025/26', state: 'published', approved_increase_pct: 12.7 },
    { id: 'y2', licensee_id: 'L', financial_year: '2026/27', state: 'published', approved_increase_pct: 10.1 },
  ],
  'tariffs.licensee': [{ id: 'L', name: 'City Power', kind: 'metro' }],
  'tariffs.tou_calendar': [{ id: 'cal', licensee_id: 'L', valid_from: '2025-04-01', valid_to: null, high_season_months: [6, 7, 8], source: 'assumed_eskom' }],
  'tariffs.tou_window': [],
  'tariffs.holiday_rule': [],
  'tariffs.sseg_rule': [],
})

describe('loadStudyPricing', () => {
  it('reads the four pricing inputs the Tariff and Load tabs store', async () => {
    const r = await loadStudyPricing(fakeSupabase({ tables: tables() as never }).client as never, P)
    if (!r.ok) throw new Error(r.code)
    const p = r.pricing
    expect(p.provenance.overrideId).toBe('ov1')
    expect(p.tariff.charges.find((c) => c.component === 'energy')!.amountExclVat).toBe(300)
    expect(p.exportMethod).toBe('manual')
    expect(p.exportTariff!.charges[0]).toMatchObject({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 0.85 })
    expect(p.provenance.exportSourceNote).toBe('City SSEG schedule p4')
    expect(p.escalationPath.published[0]).toBeCloseTo(0.101, 9) // 2026/27 approved increase
    expect(p.escalationPath.published[1]).toBeCloseTo(0.045, 9) // stored override, year 3
    expect(p.loadGrowthPct).toBe(3)
    expect(r.licenseeName).toBe('City Power')
  })

  it('money rows RLS hid (an empty read, no error) are unreadable, never priced as "no override" / "none" (security review S-6)', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    expect(await loadStudyPricing(fakeSupabase({ tables: { ...tables(), 'solar.tariff_override_charges': [] } as never }).client as never, P))
      .toEqual({ ok: false, code: 'unreadable' })
    expect(await loadStudyPricing(fakeSupabase({ tables: { ...tables({ tariff_override_id: null }), 'solar.study_export_rates': [] } as never }).client as never, P))
      .toEqual({ ok: false, code: 'unreadable' })
    err.mockRestore()
  })

  it('names what is missing', async () => {
    expect(await loadStudyPricing(fakeSupabase({}).client as never, P)).toEqual({ ok: false, code: 'noStudy' })
    const t = tables({ tariff_id: null })
    expect(await loadStudyPricing(fakeSupabase({ tables: t as never }).client as never, P)).toEqual({ ok: false, code: 'notPinned' })
  })
})

describe('(b) the Tariff tab bill check and the case run price the SAME tariff', () => {
  it('an override energy rate reaches both, with the same monthly bill', async () => {
    const eff = await loadEffectiveTariff(fakeSupabase({ tables: tables() as never }).client as never, P, '2025-03-15')
    if ('error' in eff) throw new Error(eff.error)
    const build = vi.fn(() => ({ monthlyBills: () => [], withExportRateScaled: () => { throw new Error('unused') } }))
    const run = await resolveStudyTariff(fakeSupabase({ tables: tables() as never }).client as never, P, { year: 2025, build })
    if (!run.ok) throw new Error(run.reason)
    const [runTariff, opts] = build.mock.calls[0] as unknown as [typeof eff.tariff, { exportTariff: unknown; sseg: { crediting: string } }]
    expect(runTariff).toEqual(eff.tariff)
    expect(opts.exportTariff).toEqual(run.pricing.exportTariff)
    expect(opts.sseg.crediting).not.toBe('none')
    const bill = (t: typeof eff.tariff) => runBillCheck(t, { year: 2025, month: 3, importKwh: { peak: 0, standard: 744, off_peak: 0 }, maxDemandKva: null, actualTotalExclVat: 1, note: null },
      { highSeasonMonths: null, nmdKva: null }).modelledTotalExclVat
    expect(bill(eff.tariff)).toBe(2732)
    expect(bill(runTariff)).toBe(2732)
  })
})
