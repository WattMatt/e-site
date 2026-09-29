import { describe, expect, it } from 'vitest'
import { diffTariffYears } from './yoy'
import { makeCharge, makeTariff, type TariffUnit } from './types'

const t60a = (block1: number, unit: TariffUnit = 'c_per_kWh', service = 235.79) => makeTariff({
  name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
    makeCharge({ component: 'energy', unit, amountExclVat: block1, blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }),
    makeCharge({ component: 'service', unit: 'R_per_month', amountExclVat: service }),
  ],
})

describe('diffTariffYears', () => {
  it('passes an increase inside +-3pp of the approved increase', () => {
    const d = diffTariffYears([t60a(227.28)], [t60a(247.76)], 9.01)
    expect(d.changed).toHaveLength(1)
    expect(d.changed[0].changePct).toBeCloseTo(9.011, 3)
    expect(d.unchanged).toBe(1)
    expect(d.issues).toEqual([])
  })
  it('flags an increase outside the band for review', () => {
    const d = diffTariffYears([t60a(227.28)], [t60a(288.27)], 9.01)
    expect(d.issues).toHaveLength(1)
    expect(d.issues[0]).toMatchObject({ code: 'yoy_out_of_band', severity: 'review' })
  })
  it('compares per-kWh values in rand across a c/kWh <-> R/kWh relabel', () => {
    const d = diffTariffYears([t60a(2.2728, 'R_per_kWh')], [t60a(247.76, 'c_per_kWh')], 9.01)
    expect(d.changed[0].changePct).toBeCloseTo(9.011, 3)
    expect(d.issues).toEqual([])
  })
  it('lists added and removed charges', () => {
    const next = makeTariff({ name: 'Brand New', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300 })] })
    const d = diffTariffYears([t60a(227.28)], [next], null)
    expect(d.added).toEqual(['BRAND NEW|energy|all|all|-'])
    expect(d.removed).toHaveLength(2)
  })
  it('flags a non-energy unit change instead of computing a percentage', () => {
    const prev = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 })] })
    const next = makeTariff({ name: 'x', structure: 'flat', charges: [makeCharge({ component: 'basic', unit: 'R_per_day', amountExclVat: 3.5 })] })
    const d = diffTariffYears([prev], [next], 9.01)
    expect(d.changed[0].changePct).toBeNull()
    expect(d.issues[0].code).toBe('yoy_unit_changed')
  })
})
