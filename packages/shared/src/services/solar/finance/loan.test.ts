import { describe, expect, it } from 'vitest'
import { loanSchedule } from './loan'

describe('loan schedule', () => {
  it('0 %: level principal', () => {
    const s = loanSchedule({ principalZar: 12000, annualRate: 0, termYears: 1, graceMonths: 0 }, 2)
    expect(s[0]).toEqual({ interestZar: 0, principalZar: 12000, paymentZar: 12000 })
    expect(s[1]).toEqual({ interestZar: 0, principalZar: 0, paymentZar: 0 })
  })

  it('12 % over 12 months: payment 888.4879/month, interest 661.8546 in the year', () => {
    const s = loanSchedule({ principalZar: 10000, annualRate: 0.12, termYears: 1, graceMonths: 0 }, 1)
    expect(s[0]!.paymentZar / 12).toBeCloseTo(888.4879, 4)
    expect(s[0]!.interestZar).toBeCloseTo(661.8546, 4)
    expect(s[0]!.principalZar).toBeCloseTo(10000, 8)
  })

  it('grace months are interest-only', () => {
    const s = loanSchedule({ principalZar: 10000, annualRate: 0.12, termYears: 2, graceMonths: 12 }, 2)
    expect(s[0]!.principalZar).toBe(0)
    expect(s[0]!.interestZar).toBeCloseTo(1200, 9)
    expect(s[1]!.principalZar).toBeCloseTo(10000, 8)
  })

  it('a term longer than the analysis settles the outstanding balance as a balloon in the last year', () => {
    // R1 m at 11.5 % over 15 years, analysed over 10: without the balloon ≈ R531 k of principal vanished.
    const s = loanSchedule({ principalZar: 1_000_000, annualRate: 0.115, termYears: 15, graceMonths: 0 }, 10)
    expect(s.reduce((a, y) => a + y.principalZar, 0)).toBeCloseTo(1_000_000, 6)
    expect(s[9]!.principalZar).toBeGreaterThan(500_000)
    expect(s[9]!.paymentZar).toBeCloseTo(s[9]!.interestZar + s[9]!.principalZar, 9)
  })

  it('refuses a grace period as long as the term', () => {
    expect(() => loanSchedule({ principalZar: 1, annualRate: 0.1, termYears: 1, graceMonths: 12 }, 1)).toThrow(/grace months/)
  })
})
