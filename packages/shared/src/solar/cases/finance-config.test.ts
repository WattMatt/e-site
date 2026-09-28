import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { applyRateCard, capexTotals, defaultFinanceConfig, parseFinanceConfig, VAT_RATE, type CapexLine } from './finance-config'

const settings = solarOrgSettingDefaults()
const line = (over: Partial<CapexLine>): CapexLine => ({
  id: 'l1', category: 'modules', description: 'x', qty: 1, unit: 'item', rateZar: 0, qualifies12b: true, source: 'manual', ...over,
})

describe('defaultFinanceConfig', () => {
  it('takes D-05/D-07/D-16 defaults from org settings; cash only; tax off at 27 %', () => {
    const f = defaultFinanceConfig(settings)
    expect(f.capex).toEqual([])
    expect(f.opex).toMatchObject({ omMode: 'per_kwp', omZarPerKwpYear: 150, insurancePctOfCapex: 0.5, inverterReplacementYear: 12, inverterReplacementPct: 60, batteryReplacementYear: 10, batteryReplacementPct: 50 })
    expect(f.models.cash.enabled).toBe(true)
    expect([f.models.debt.enabled, f.models.ppa.enabled, f.models.lease.enabled]).toEqual([false, false, false])
    expect(f.analysis).toMatchObject({ years: 25, discountRatePct: 11, cpiPct: 5, escalationStartPct: 9, escalationYear10Pct: 7, escalationAfterCpiPlusPct: 1, taxEnabled: false, companyTaxRatePct: 27, section12b: false })
    expect(parseFinanceConfig(f).ok).toBe(true)
  })

  it('refuses a config with no finance model', () => {
    const f = defaultFinanceConfig(settings)
    const r = parseFinanceConfig({ ...f, models: { ...f.models, cash: { enabled: false } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors.models).toBe('Choose at least one finance model')
  })

  it('refuses a PPA buy-out with a year but no price', () => {
    const f = defaultFinanceConfig(settings)
    const r = parseFinanceConfig({ ...f, models: { ...f.models, ppa: { ...f.models.ppa, enabled: true, startTariffZarPerKwh: 1.5, buyoutYear: 10, buyoutPriceZar: null } } })
    expect(r.ok).toBe(false)
    if (!r.ok) expect(r.errors['models.ppa.buyoutPriceZar']).toBe('Enter both the buy-out year and price, or neither')
  })
})

describe('capexTotals', () => {
  it('R/Wp on the correct scale: capex ÷ DC Wp; VAT separate', () => {
    const t = capexTotals([line({ qty: 500_000, unit: 'Wp', rateZar: 9 }), line({ id: 'b', category: 'battery', qty: 200, unit: 'kWh', rateZar: 5000, qualifies12b: false })], 500)
    expect(t.exclVatZar).toBe(5_500_000)
    expect(t.vatZar).toBeCloseTo(5_500_000 * VAT_RATE, 6)
    expect(t.inclVatZar).toBeCloseTo(5_500_000 * (1 + VAT_RATE), 6)
    expect(t.zarPerWp).toBeCloseTo(11, 9)
    expect(t.batteryZar).toBe(1_000_000)
    expect(t.qualifying12bZar).toBe(4_500_000)
  })
  it('no DC size → no R/Wp', () => {
    expect(capexTotals([], 0).zarPerWp).toBeNull()
  })
})

describe('applyRateCard', () => {
  const card = { ...settings, rc_pv_r_per_wp_small: 12, rc_pv_r_per_wp_medium: 10, rc_pv_r_per_wp_large: 8.5, rc_inverter_r_per_kw: 1500, rc_battery_r_per_kwh: 6000, rc_bos_pct: 8, rc_fees_pct: 5, rc_pm_pct: 3, rc_contingency_pct: 5, rc_margin_pct: 10 }

  it('names the missing rate instead of inventing a price (engine spec §7)', () => {
    const r = applyRateCard(defaultFinanceConfig(settings), settings, { dcKwp: 500, acKw: 400, batteryKwh: 0 })
    expect(r).toEqual({ ok: false, missing: ['PV system, 100 kWp to 1 MWp (R/Wp)'] })
  })

  it('picks the size band, prices percentages on the equipment subtotal, keeps manual lines', () => {
    const base = { ...defaultFinanceConfig(settings), capex: [line({ id: 'm1', category: 'civils', qty: 1, unit: 'lot', rateZar: 50_000 })] }
    const r = applyRateCard(base, card, { dcKwp: 500, acKw: 400, batteryKwh: 100 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const byId = Object.fromEntries(r.fin.capex.map((l) => [l.id, l]))
    expect(byId.m1.rateZar).toBe(50_000)
    expect(byId['rc-pv']).toMatchObject({ category: 'modules', qty: 500_000, unit: 'Wp', rateZar: 10, source: 'rate_card' })
    expect(byId['rc-inv']).toMatchObject({ qty: 400, unit: 'kW', rateZar: 1500 })
    expect(byId['rc-bat']).toMatchObject({ qty: 100, unit: 'kWh', rateZar: 6000, qualifies12b: false })
    const equipment = 5_000_000 + 600_000 + 600_000
    expect(byId['rc-bos'].rateZar).toBeCloseTo(equipment * 0.08, 2)
    const sub = equipment * 1.08
    expect(byId['rc-fees'].rateZar).toBeCloseTo(sub * 0.05, 2)
    expect(byId['rc-margin'].rateZar).toBeCloseTo(sub * 0.10, 2)
  })

  it('re-applying replaces the previous rate-card lines, never duplicates them', () => {
    const once = applyRateCard(defaultFinanceConfig(settings), card, { dcKwp: 50, acKw: 40, batteryKwh: 0 })
    if (!once.ok) throw new Error('expected ok')
    const twice = applyRateCard(once.fin, card, { dcKwp: 50, acKw: 40, batteryKwh: 0 })
    if (!twice.ok) throw new Error('expected ok')
    expect(twice.fin.capex.filter((l) => l.id === 'rc-pv')).toHaveLength(1)
    expect(twice.fin.capex.find((l) => l.id === 'rc-pv')!.rateZar).toBe(12)
  })
})
