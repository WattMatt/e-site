import { describe, it, expect } from 'vitest'
import { dayTypeOf, referenceYearDates } from './calendar'
import { ARCHETYPE_CODES, CATEGORY_ARCHETYPE, DEFAULT_DENSITY_W_PER_M2, expandArchetype, getArchetype, LOAD_ARCHETYPES } from './archetypes'

describe('archetypes', () => {
  it('eight, in a fixed order', () => {
    expect(LOAD_ARCHETYPES.map((a) => a.code)).toEqual([...ARCHETYPE_CODES])
    expect(ARCHETYPE_CODES).toEqual(['retail', 'fast_food', 'restaurant', 'supermarket', 'office_bank', 'gym', 'anchor_24h', 'vacant'])
    for (const a of LOAD_ARCHETYPES) {
      for (const t of ['weekday', 'saturday', 'sunday', 'holiday'] as const) expect(a.profiles[t]).toHaveLength(24)
      expect(a.seasonal).toHaveLength(12)
    }
  })

  it.each(ARCHETYPE_CODES.filter((c) => c !== 'vacant'))('%s: mean over operating hours of the expanded year = 1', (code) => {
    const a = getArchetype(code)
    const s = expandArchetype(a, 2027)
    const dates = referenceYearDates(2027)
    let sum = 0
    let n = 0
    dates.forEach((d, di) => {
      const w = a.operating[dayTypeOf(d)]
      if (!w) return
      for (let h = w[0]; h < w[1]; h++) {
        sum += s[di * 24 + h]
        n++
      }
    })
    expect(sum / n).toBeCloseTo(1, 9)
  })

  it('vacant is all zero', () => {
    expect(expandArchetype(getArchetype('vacant'), 2027).every((v) => v === 0)).toBe(true)
  })

  it('supermarket keeps a 35 % refrigeration base overnight', () => {
    const s = expandArchetype(getArchetype('supermarket'), 2027)
    const di = referenceYearDates(2027).indexOf('2027-01-04')   // a Monday
    expect(s[di * 24 + 2] / s[di * 24 + 12]).toBeCloseTo(0.35, 10)
  })

  it('retail is closed on Sundays and public holidays', () => {
    const s = expandArchetype(getArchetype('retail'), 2027)
    const dates = referenceYearDates(2027)
    const at = (d: string, h: number) => s[dates.indexOf(d) * 24 + h]
    expect(at('2027-03-22', 12) / at('2027-03-23', 12)).toBeCloseTo(0.15, 10)   // observed holiday vs Tuesday
  })

  it('densities come from the GCR category rates (kW/m² × 1000)', () => {
    expect(DEFAULT_DENSITY_W_PER_M2).toEqual({ standard: 30, fast_food: 45, restaurant: 45, national: 30, other: 30 })
    expect(CATEGORY_ARCHETYPE).toEqual({ standard: 'retail', fast_food: 'fast_food', restaurant: 'restaurant', national: 'supermarket', other: 'retail' })
  })
})
