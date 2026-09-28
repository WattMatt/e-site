import { describe, expect, it } from 'vitest'
import { costMonth, costPeriod } from './bill-engine'
import { netBillingRule } from './net-billing-rules'
import { validateTariffYear } from './validators'
import { makeCharge, makeTariff, type Charge, type MonthUsage, type SsegRule, type TariffSeason, type TouOrAll } from './types'

const c = (season: TariffSeason, tou: TouOrAll, cents: number, component: Charge['component'] = 'energy'): Charge =>
  makeCharge({ component, unit: 'c_per_kWh', amountExclVat: cents, season, tou })
const perDay = (component: Charge['component'], rand: number, demandBasis: Charge['demandBasis'] = null): Charge =>
  makeCharge({ component, unit: 'R_per_POD_day', amountExclVat: rand, demandBasis })

// Eskom 2025/26, xlsm `Homeflex NLA` row 11 (HF101N) and row 18; `Gen-offset` row 49 (GOHF101N).
const homeflex1 = makeTariff({ name: 'Homeflex 1 (HF101N)', code: 'HF101N', structure: 'tou', exportTariffCode: 'GOHF101N', charges: [
  c('high', 'peak', 706.97), c('high', 'standard', 216.31), c('high', 'off_peak', 159.26),
  c('low', 'peak', 329.28), c('low', 'standard', 204.9), c('low', 'off_peak', 159.26),
  perDay('service', 3.27),
  c('all', 'all', 0.41, 'ancillary'), c('all', 'all', 22.78, 'legacy'), c('all', 'all', 26.37, 'network_demand'),
  perDay('network_capacity', 12.13, 'nmd'), perDay('gcc', 0.72),
] })
const genOffsetHomeflex = makeTariff({ name: 'Gen-Offset Homeflex (GOHF101N)', code: 'GOHF101N', structure: 'tou', category: 'sseg', charges: [
  c('high', 'peak', 650.52, 'export_credit'), c('high', 'standard', 185.41, 'export_credit'), c('high', 'off_peak', 131.21, 'export_credit'),
  c('low', 'peak', 292.75, 'export_credit'), c('low', 'standard', 174.58, 'export_credit'), c('low', 'off_peak', 131.21, 'export_credit'),
] })
const eskomRule = netBillingRule('eskom')
const july = (importKwh: MonthUsage['importKwh'], exportKwh: MonthUsage['exportKwh']): MonthUsage =>
  ({ year: 2025, month: 7, days: 30, season: 'high', importKwh, exportKwh })

describe('golden case 10: Eskom Homeflex 1 + Gen-Offset Homeflex', () => {
  it('high season, import P100/S300/O200, export S150 -> R2,177.26', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 150, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule })
    expect(bill.energyCharges).toBe(1674.42)
    const adders = bill.lines.filter((l) => l.kind === 'adder').reduce((a, l) => a + l.amount, 0)
    expect(adders).toBeCloseTo(297.36, 6)
    expect(bill.credit.earned).toBe(278.12)
    expect(bill.credit.used).toBe(278.12)
    expect(bill.totalExclVat).toBe(2177.26)
  })

  it('variant: export S400 is capped at the 300 kWh imported in standard -> credit R556.23', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 400, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule })
    expect(bill.credit.creditedKwh).toEqual({ peak: 0, standard: 300, off_peak: 0 })
    expect(bill.credit.earned).toBe(556.23)
    expect(bill.totalExclVat).toBe(1899.15)
  })

  it('offsets active energy only: adders, fixed and capacity charges are never reduced', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 5000, standard: 5000, off_peak: 5000 }),
      { exportTariff: genOffsetHomeflex, sseg: { ...eskomRule, capRule: 'energy_charges' } })
    expect(bill.credit.used).toBe(1674.42)
    expect(bill.totalExclVat).toBe(780.96) // 297.36 + 98.10 + 363.90 + 21.60
    expect(bill.credit.carriedOut).toBeGreaterThan(0)
  })

  it('refuses net billing above the 1,000 kVA limit, with a warning', () => {
    const bill = costMonth(homeflex1, july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 150, off_peak: 0 }),
      { exportTariff: genOffsetHomeflex, sseg: eskomRule, systemKva: 1200 })
    expect(bill.credit.earned).toBe(0)
    expect(bill.credit.warnings[0]).toMatch(/1000 kVA/)
  })
})

describe('carry-forward and the financial-year reset', () => {
  const flat = makeTariff({ name: 'flat with SSEG', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
    makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 }),
    makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
  ] })
  const month = (m: number, imp: number, exp: number): MonthUsage =>
    ({ year: 2026, month: m, days: 30, season: 'low', importKwh: { peak: 0, standard: imp, off_peak: 0 }, exportKwh: { peak: 0, standard: exp, off_peak: 0 } })
  const municipalFlat: SsegRule = { ...netBillingRule('municipal', { touExport: false }), capRule: 'energy_charges' }

  it('carries excess credit forward, forfeits it at June (municipal FY end), starts July at zero', () => {
    const [may, jun, jul] = costPeriod(flat, [month(5, 100, 500), month(6, 100, 0), month(7, 100, 0)], { sseg: municipalFlat })
    expect(may.credit).toMatchObject({ earned: 500, used: 200, carriedOut: 300, forfeited: 0 })
    expect(may.totalExclVat).toBe(100)
    expect(jun.credit).toMatchObject({ carriedIn: 300, used: 200, carriedOut: 0, forfeited: 100 })
    expect(jun.totalExclVat).toBe(100)
    expect(jul.credit).toMatchObject({ carriedIn: 0, used: 0 })
    expect(jul.totalExclVat).toBe(300)
  })

  it('uses the Eskom year end (March) for Eskom', () => {
    const eskomFlat: SsegRule = { ...netBillingRule('eskom', { touExport: false }), capRule: 'energy_charges' }
    const [feb, mar, apr] = costPeriod(flat, [month(2, 100, 500), month(3, 100, 0), month(4, 100, 0)], { sseg: eskomFlat })
    expect(feb.credit.carriedOut).toBe(300)
    expect(mar.credit.forfeited).toBe(100)
    expect(apr.credit.carriedIn).toBe(0)
  })

  it('never pays credit as cash: the bill never falls below the non-energy charges', () => {
    const [m] = costPeriod(flat, [month(1, 100, 100000)], { sseg: municipalFlat })
    expect(m.totalExclVat).toBe(100)
  })

  it('caps flat crediting at imported kWh unless the rule says otherwise', () => {
    const capped = costMonth(flat, month(1, 100, 500), { sseg: netBillingRule('municipal', { touExport: false }) })
    expect(capped.credit.creditedTotalKwh).toBe(100)
    expect(capped.credit.earned).toBe(100)
  })

  it('forfeits every month when the rule carries nothing forward', () => {
    const [a, b] = costPeriod(flat, [month(1, 100, 500), month(2, 100, 0)], { sseg: { ...municipalFlat, carryForward: 'none' } })
    expect(a.credit.forfeited).toBe(300)
    expect(b.credit.carriedIn).toBe(0)
  })
})

describe('c/kWh vs R/kWh: the engine follows the stored unit and never guesses', () => {
  const blocks = (unit: 'c_per_kWh' | 'R_per_kWh', k: number) => makeTariff({ name: 'City Power 60A', structure: 'ibt', charges: [
    makeCharge({ component: 'energy', unit, amountExclVat: 227.28 * k, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }),
    makeCharge({ component: 'energy', unit, amountExclVat: 260.83 * k, blockMinKwh: 500, blockMaxKwh: null, blockBasis: 'monthly' }),
  ] })
  const u: MonthUsage = { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: 800, off_peak: 0 } }

  it('costs 227.28 c/kWh and 2.2728 R/kWh identically', () => {
    expect(costMonth(blocks('c_per_kWh', 1), u).totalExclVat).toBe(1918.89)
    expect(costMonth(blocks('R_per_kWh', 0.01), u).totalExclVat).toBe(1918.89)
  })

  it('costs an unconverted 3.09 "c/kWh" at 100x low — and the validator blocks it', () => {
    const wrong = makeTariff({ name: 'Scale 1A (unconverted)', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 3.09 }),
    ] })
    const bill = costMonth(wrong, { ...u, importKwh: { peak: 0, standard: 500, off_peak: 0 } })
    expect(bill.totalExclVat).toBe(15.45)
    expect(validateTariffYear([wrong]).map((i) => i.code)).toContain('energy_out_of_range')
  })
})
