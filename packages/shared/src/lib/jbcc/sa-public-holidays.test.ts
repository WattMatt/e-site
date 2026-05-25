// packages/shared/src/lib/jbcc/sa-public-holidays.test.ts
import { describe, it, expect } from 'vitest'
import { isPublicHoliday, listHolidays } from './sa-public-holidays'

describe('SA public holidays', () => {
  it('flags fixed-date holidays', () => {
    expect(isPublicHoliday(new Date('2026-01-01'))).toBe(true) // New Year
    expect(isPublicHoliday(new Date('2026-03-21'))).toBe(true) // Human Rights
    expect(isPublicHoliday(new Date('2026-04-27'))).toBe(true) // Freedom
    expect(isPublicHoliday(new Date('2026-05-01'))).toBe(true) // Workers
    expect(isPublicHoliday(new Date('2026-06-16'))).toBe(true) // Youth
    expect(isPublicHoliday(new Date('2026-09-24'))).toBe(true) // Heritage
    expect(isPublicHoliday(new Date('2026-12-16'))).toBe(true) // Reconciliation
    expect(isPublicHoliday(new Date('2026-12-25'))).toBe(true) // Christmas
    expect(isPublicHoliday(new Date('2026-12-26'))).toBe(true) // Day of Goodwill
  })

  it('computes Easter-derived holidays (2026: Easter Sun = Apr 5)', () => {
    expect(isPublicHoliday(new Date('2026-04-03'))).toBe(true) // Good Friday
    expect(isPublicHoliday(new Date('2026-04-06'))).toBe(true) // Family Day
  })

  it("applies the Sunday rule (Women's Day 2026 falls on Sun 9 Aug)", () => {
    expect(isPublicHoliday(new Date('2026-08-09'))).toBe(true)  // gazetted Sun
    expect(isPublicHoliday(new Date('2026-08-10'))).toBe(true)  // observed Mon
  })

  it('does not flag ordinary weekdays', () => {
    expect(isPublicHoliday(new Date('2026-06-15'))).toBe(false) // Mon before Youth Day
    expect(isPublicHoliday(new Date('2026-07-04'))).toBe(false)
  })

  it('listHolidays(2026) returns at least 12 dates', () => {
    expect(listHolidays(2026).length).toBeGreaterThanOrEqual(12)
  })
})
