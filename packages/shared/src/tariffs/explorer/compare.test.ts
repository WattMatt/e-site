import { describe, expect, it } from 'vitest'
import { compareTariffs } from './compare'
import type { ConsumptionProfile } from './profile'
import { ch, tariff } from './fixtures'

const P: ConsumptionProfile = { monthlyKwh: 1000, touSplit: { peak: 0.25, standard: 0.5, off_peak: 0.25 }, maxDemandKva: null, nmdKva: null, powerFactor: 0.95 }

const flat = tariff('Flat', [
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300 }),
  ch({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 }),
], { structure: 'flat' })
const tou = tariff('TOU', [
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 400, season: 'all', tou: 'peak' }),
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, season: 'all', tou: 'standard' }),
  ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100, season: 'all', tou: 'off_peak' }),
])

describe('compareTariffs', () => {
  it('prices one profile across tariffs and ranks them cheapest first', () => {
    const r = compareTariffs(P, [
      { key: 'f', label: 'Flat', tariff: flat, highSeasonMonths: [6, 7, 8] },
      { key: 't', label: 'TOU', tariff: tou, highSeasonMonths: [6, 7, 8] },
    ], 2026)
    expect(r.map((x) => x.key)).toEqual(['t', 'f'])
    // TOU: 1000 kWh x (0.25 x 4 + 0.5 x 2 + 0.25 x 1) = R2,250 a month.
    expect(r[0].annualExclVat).toBeCloseTo(2250 * 12, 6)
    // Flat: 1000 x R3 + R100 basic = R3,100 a month.
    expect(r[1].annualExclVat).toBeCloseTo(3100 * 12, 6)
    expect(r[1].annualInclVat).toBeCloseTo(3100 * 12 * 1.15, 6)
    expect(r[0].effectiveCPerKwh).toBeCloseTo(225, 6)
    expect(r[0].monthlyExclVat).toHaveLength(12)
  })

  it('lists what the engine could not price, once per charge', () => {
    const demand = tariff('Demand', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100 }),
      ch({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 20, demandBasis: 'nmd' }),
    ], { structure: 'flat' })
    const [r] = compareTariffs(P, [{ key: 'd', label: 'Demand', tariff: demand, highSeasonMonths: [6, 7, 8] }], 2026)
    expect(r.notModelled.length).toBe(1)
    expect(r.notModelled[0].component).toBe('network_capacity')
  })

  it('refuses more than four tariffs', () => {
    const many = Array.from({ length: 5 }, (_, i) => ({ key: String(i), label: String(i), tariff: flat, highSeasonMonths: [6, 7, 8] }))
    expect(() => compareTariffs(P, many, 2026)).toThrow(/at most 4/)
  })
})
