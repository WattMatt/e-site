import { describe, it, expect } from 'vitest'
import { addDays, dayTypeOf, daysBetween, fillDayTypeOf, intervalStartLocal, referenceYearDates } from './calendar'

describe('calendar', () => {
  it('day types use the SA public-holiday table (incl. Sunday-rule observances)', () => {
    expect(dayTypeOf('2027-01-01')).toBe('holiday')   // Friday, New Year
    expect(dayTypeOf('2027-01-02')).toBe('saturday')
    expect(dayTypeOf('2027-01-03')).toBe('sunday')
    expect(dayTypeOf('2027-01-04')).toBe('weekday')
    expect(dayTypeOf('2027-03-21')).toBe('holiday')   // Sunday AND Human Rights Day
    expect(dayTypeOf('2027-03-22')).toBe('holiday')   // observed Monday
    expect(dayTypeOf('2027-12-27')).toBe('holiday')   // Day of Goodwill (Sunday 26th) observed
    expect(fillDayTypeOf('2027-03-22')).toBe('sunday_holiday')
    expect(fillDayTypeOf('2027-01-03')).toBe('sunday_holiday')
  })
  it('reference year: 365 dates, 29 Feb dropped', () => {
    const d = referenceYearDates(2028)
    expect(d).toHaveLength(365)
    expect(d).not.toContain('2028-02-29')
    expect([d[0], d[364]]).toEqual(['2028-01-01', '2028-12-31'])
    expect(referenceYearDates(2027)).toHaveLength(365)
  })
  it('date arithmetic', () => {
    expect(addDays('2025-02-28', 1)).toBe('2025-03-01')
    expect(addDays('2025-03-01', -1)).toBe('2025-02-28')
    expect(daysBetween('2025-01-01', '2025-12-31')).toBe(364)
  })
  it('interval start in SAST from ts_end', () => {
    expect(intervalStartLocal(Date.UTC(2025, 2, 9, 22, 30), 30)).toEqual({ date: '2025-03-10', hour: 0, minute: 0 })
    expect(intervalStartLocal(Date.UTC(2025, 2, 9, 22, 0), 30)).toEqual({ date: '2025-03-09', hour: 23, minute: 30 })
  })
})
