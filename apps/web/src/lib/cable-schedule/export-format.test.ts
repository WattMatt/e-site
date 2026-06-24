import { describe, it, expect } from 'vitest'
import { formatDecimal } from './export-format'

describe('formatDecimal', () => {
  it('formats to the requested decimals', () => {
    expect(formatDecimal(1.234, 2)).toBe('1.23')
    expect(formatDecimal(1.5, 2)).toBe('1.50')
  })
  it('rounds to an integer when dp is 0', () => {
    expect(formatDecimal(1.5)).toBe('2')
    expect(formatDecimal(60)).toBe('60')
  })
  it('returns empty string for null, undefined, or non-finite', () => {
    expect(formatDecimal(null)).toBe('')
    expect(formatDecimal(undefined)).toBe('')
    expect(formatDecimal(Number.NaN)).toBe('')
    expect(formatDecimal(Infinity)).toBe('')
  })
})
