import { describe, expect, it } from 'vitest'
import { roundCents } from './money'

describe('roundCents', () => {
  it('rounds half away from zero even where binary floats sit just below the half', () => {
    // 150 kWh x 185.41 c = 278.115 exactly on paper; 278.115 * 100 is 27811.499999... in binary.
    expect(roundCents(150 * 1.8541)).toBe(278.12)
    expect(roundCents(1.005)).toBe(1.01)
    expect(roundCents(-278.115)).toBe(-278.12)
  })
  it('leaves exact cents alone and never returns -0', () => {
    expect(roundCents(2849.26)).toBe(2849.26)
    expect(Object.is(roundCents(-0.001), 0)).toBe(true)
  })
  it('refuses a non-finite amount', () => {
    expect(() => roundCents(Number.NaN)).toThrow(RangeError)
  })
})
