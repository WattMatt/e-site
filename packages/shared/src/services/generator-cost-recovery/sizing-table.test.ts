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

  it('throws for an unknown generator size', () => {
    expect(() => getFuelConsumption('999 kVA', 75)).toThrow()
  })
})
