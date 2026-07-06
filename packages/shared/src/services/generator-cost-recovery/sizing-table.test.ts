import { describe, it, expect } from 'vitest'
import { getFuelConsumption } from './sizing-table'

describe('getFuelConsumption', () => {
  it('returns exact value at a defined load point (100 kVA @ 75%)', () => {
    // Table: 100 kVA load75 = 14.18
    expect(getFuelConsumption('100 kVA', 75)).toBeCloseTo(14.18, 3)
  })

  it('interpolates between 50% and 75% for 100 kVA @ 62.5%', () => {
    // load50 = 11, load75 = 14.18
    // t = (62.5 - 50) / (75 - 50) = 0.5
    // expected = 11 + 0.5 * (14.18 - 11) = 11 + 1.59 = 12.59
    expect(getFuelConsumption('100 kVA', 62.5)).toBeCloseTo(12.59, 3)
  })

  it('returns 0 for an unknown generator size (matches nexus, which does not throw)', () => {
    expect(getFuelConsumption('999 kVA', 75)).toBe(0)
  })

  // The zone editor stores whatever the user typed — prod PNP FAERIE GLEN holds
  // bare "400" / "350". An exact-label lookup silently zeroed the whole tariff.
  it('resolves a bare numeric size ("400" @ 75%) to the 400 kVA row', () => {
    expect(getFuelConsumption('400', 75)).toBeCloseTo(61.6, 3)
  })

  it('resolves "350" @ 75% to the 350 kVA row', () => {
    expect(getFuelConsumption('350', 75)).toBeCloseTo(50.14, 3)
  })

  it('resolves suffix variants ("400kVA", "400 kva") to the 400 kVA row', () => {
    expect(getFuelConsumption('400kVA', 75)).toBeCloseTo(61.6, 3)
    expect(getFuelConsumption('400 kva', 75)).toBeCloseTo(61.6, 3)
  })

  it('still returns 0 for a numeric size with no table row ("415")', () => {
    expect(getFuelConsumption('415', 75)).toBe(0)
  })

  it('hasFuelRating mirrors the lookup (used by readiness)', async () => {
    const { hasFuelRating } = await import('./sizing-table')
    expect(hasFuelRating('400')).toBe(true)
    expect(hasFuelRating('400 kVA')).toBe(true)
    expect(hasFuelRating('415')).toBe(false)
    expect(hasFuelRating(null)).toBe(false)
    expect(hasFuelRating('')).toBe(false)
  })
})
