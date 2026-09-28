import { describe, it, expect } from 'vitest'
import { rand, mwh, num, pct, years, kw } from './format'

describe('solar display format (units always shown, spec §0.4 rule 3)', () => {
  it('rand: space thousands, dot decimals, R prefix; negatives', () => {
    expect(rand(3406513.93)).toBe('R 3 406 514')
    expect(rand(-1200.4)).toBe('−R 1 200')
    expect(rand(1234.5, 2)).toBe('R 1 234.50')
  })
  it('mwh / num / pct / years / kw', () => {
    expect(mwh(1_234_567)).toBe('1 234.6 MWh')
    expect(num(1690.4, 0)).toBe('1 690')
    expect(pct(0.1234)).toBe('12.3 %')
    expect(years(null)).toBe('n/a')
    expect(years(5.26)).toBe('5.3 years')
    expect(kw(320)).toBe('320.0 kW')
  })
  it('a value that rounds to zero is not signed', () => {
    expect(num(-0.04, 1)).toBe('0.0')
    expect(rand(-0.4)).toBe('R 0')
  })
})
