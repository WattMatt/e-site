import { describe, expect, it } from 'vitest'
import { effectiveDates, fyEndMonth, parseFinancialYear, previousFinancialYear } from './financial-year'

describe('financial years', () => {
  it('parses a well-formed year and refuses a malformed one', () => {
    expect(parseFinancialYear('2026/27')).toEqual({ startYear: 2026 })
    expect(parseFinancialYear('2099/00')).toEqual({ startYear: 2099 })
    expect(() => parseFinancialYear('2026/28')).toThrow(RangeError)
    expect(() => parseFinancialYear('2026-27')).toThrow(RangeError)
  })
  it('finds the predecessor year', () => {
    expect(previousFinancialYear('2026/27')).toBe('2025/26')
    expect(previousFinancialYear('2000/01')).toBe('1999/00')
  })
  it('gives Eskom (1 April) and municipal (1 July) effective dates and FY-end months', () => {
    expect(effectiveDates('eskom', '2025/26')).toEqual({ from: '2025-04-01', to: '2026-03-31' })
    expect(effectiveDates('municipal', '2025/26')).toEqual({ from: '2025-07-01', to: '2026-06-30' })
    expect(fyEndMonth('eskom')).toBe(3)
    expect(fyEndMonth('municipal')).toBe(6)
  })
})
