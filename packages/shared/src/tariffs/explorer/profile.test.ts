import { describe, expect, it } from 'vitest'
import { buildProfileMonths, validateProfile, type ConsumptionProfile } from './profile'

const P: ConsumptionProfile = { monthlyKwh: 10000, touSplit: { peak: 0.2, standard: 0.45, off_peak: 0.35 }, maxDemandKva: 50, nmdKva: 60, powerFactor: 0.95 }

describe('validateProfile', () => {
  it('accepts a sound profile', () => {
    expect(validateProfile(P)).toEqual([])
  })
  it('refuses a split that does not add up to 100 %', () => {
    expect(validateProfile({ ...P, touSplit: { peak: 0.5, standard: 0.45, off_peak: 0.35 } })).toContain('The peak, standard and off-peak shares must add up to 100 %.')
  })
  it('refuses negative or missing energy, and a power factor outside (0, 1]', () => {
    expect(validateProfile({ ...P, monthlyKwh: -1 })).toContain('Monthly energy must be zero or more kWh.')
    expect(validateProfile({ ...P, powerFactor: 1.2 })).toContain('Power factor must be above 0 and at most 1.')
    expect(validateProfile({ ...P, byMonthKwh: [1, 2, 3] })).toContain('A month-by-month profile needs exactly 12 values.')
  })
})

describe('buildProfileMonths', () => {
  it('builds twelve months of the reference year with the season from the calendar', () => {
    const m = buildProfileMonths(P, { highSeasonMonths: [6, 7, 8], year: 2026 })
    expect(m).toHaveLength(12)
    expect(m.map((x) => x.season)).toEqual(['low', 'low', 'low', 'low', 'low', 'high', 'high', 'high', 'low', 'low', 'low', 'low'])
    expect(m.map((x) => x.days)).toEqual([31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31])
  })
  it('splits each month by the TOU shares and carries demand', () => {
    const [jan] = buildProfileMonths(P, { highSeasonMonths: [6, 7, 8], year: 2026 })
    expect(jan.importKwh).toEqual({ peak: 2000, standard: 4500, off_peak: 3500 })
    expect(jan.maxDemandKva).toBe(50)
    expect(jan.peakWindowMdKva).toBe(50)
    expect(jan.maxDemandKw).toBeCloseTo(47.5, 6)
    expect(jan.nmdKva).toBe(60)
  })
  it('uses month-by-month energy when given', () => {
    const by = Array.from({ length: 12 }, (_, i) => (i + 1) * 100)
    const m = buildProfileMonths({ ...P, byMonthKwh: by }, { highSeasonMonths: [6, 7, 8], year: 2026 })
    expect(m[11].importKwh.peak + m[11].importKwh.standard + m[11].importKwh.off_peak).toBeCloseTo(1200, 9)
  })
  it('throws on an invalid profile rather than pricing nonsense', () => {
    expect(() => buildProfileMonths({ ...P, monthlyKwh: Number.NaN }, { highSeasonMonths: [], year: 2026 })).toThrow(/Monthly energy/)
  })
})
