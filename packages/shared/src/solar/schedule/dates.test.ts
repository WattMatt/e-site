// The time zone must be SAST BEFORE any Date is built in this file; the guard
// test below fails loudly if the runtime ignored it (a round-trip test that
// silently ran in UTC would prove nothing — UTC is exactly where WM's bug hides).
process.env.TZ = 'Africa/Johannesburg'

import { describe, it, expect } from 'vitest'
import {
  isCalendarDate, dayNumber, fromDayNumber, addCalendarDays, daysBetween, weekdayOf,
  sastToday, parseDateInput, formatCalendarDate, calendarDateFromUtc, mondayOf,
  minCalendarDate, maxCalendarDate,
} from './dates'

describe('the test really runs in SAST', () => {
  it('local offset is UTC+2', () => {
    expect(new Date(2026, 0, 1).getTimezoneOffset()).toBe(-120)
  })
  it('reproduces WM Solar’s defect with WM’s own code path (proves the environment can fail)', () => {
    // WM: parse local midnight, write with toISOString() (as-is/06 B.3.1, PG:147-148)
    const wmSave = (s: string) => new Date(`${s}T00:00:00`).toISOString().split('T')[0]
    expect(wmSave('2026-10-01')).toBe('2026-09-30')
  })
})

describe('CalendarDate arithmetic never drifts', () => {
  it('every day of 2026–2028 round-trips through dayNumber unchanged', () => {
    let d = '2026-01-01'
    for (let i = 0; i < 365 + 365 + 366; i++) { // 2026, 2027, 2028 (leap)
      expect(fromDayNumber(dayNumber(d))).toBe(d)
      d = addCalendarDays(d, 1)
    }
    expect(d).toBe('2029-01-01')
  })
  it('ten successive edit round trips keep the date (WM lost ten days)', () => {
    let d = '2026-10-01'
    for (let i = 0; i < 10; i++) d = fromDayNumber(dayNumber(parseDateInput(d)!))
    expect(d).toBe('2026-10-01')
  })
  it('adds and subtracts across month, year and leap boundaries', () => {
    expect(addCalendarDays('2026-12-31', 1)).toBe('2027-01-01')
    expect(addCalendarDays('2028-02-28', 1)).toBe('2028-02-29')
    expect(addCalendarDays('2028-03-01', -1)).toBe('2028-02-29')
    expect(daysBetween('2026-10-01', '2026-10-08')).toBe(7)
    expect(daysBetween('2026-10-08', '2026-10-01')).toBe(-7)
  })
  it('knows the weekday without a local Date', () => {
    expect(weekdayOf('2026-10-01')).toBe(4) // Thursday
    expect(weekdayOf('2026-09-21')).toBe(1) // Monday
    expect(weekdayOf('2026-08-09')).toBe(0) // Sunday
    expect(mondayOf('2026-10-01')).toBe('2026-09-28')
    expect(mondayOf('2026-09-28')).toBe('2026-09-28')
  })
})

describe('validation and formatting', () => {
  it('accepts only real ISO calendar dates', () => {
    expect(isCalendarDate('2026-02-28')).toBe(true)
    expect(isCalendarDate('2026-02-29')).toBe(false)
    expect(isCalendarDate('2026-13-01')).toBe(false)
    expect(isCalendarDate('2026-1-01')).toBe(false)
    expect(isCalendarDate('2026-10-01T00:00:00Z')).toBe(false)
    expect(isCalendarDate(20261001)).toBe(false)
    expect(() => dayNumber('nope')).toThrow('Not a calendar date')
  })
  it('parseDateInput trims and refuses junk', () => {
    expect(parseDateInput(' 2026-10-01 ')).toBe('2026-10-01')
    expect(parseDateInput('')).toBeNull()
    expect(parseDateInput('01/10/2026')).toBeNull()
  })
  it('formats for people without a Date', () => {
    expect(formatCalendarDate('2026-10-01')).toBe('1 Oct 2026')
  })
  it('reads UTC components of a UTC-midnight Date (exceljs cells, holiday source)', () => {
    expect(calendarDateFromUtc(new Date(Date.UTC(2026, 8, 24)))).toBe('2026-09-24')
  })
  it('min / max of a list', () => {
    expect(minCalendarDate(['2026-10-05', '2026-09-30', '2026-10-01'])).toBe('2026-09-30')
    expect(maxCalendarDate(['2026-10-05', '2026-09-30'])).toBe('2026-10-05')
    expect(minCalendarDate([])).toBeNull()
  })
})

describe('sastToday', () => {
  it('23:30 UTC is already tomorrow in South Africa', () => {
    expect(sastToday(new Date('2026-09-28T23:30:00Z'))).toBe('2026-09-29')
  })
  it('21:59 UTC is still today', () => {
    expect(sastToday(new Date('2026-09-28T21:59:00Z'))).toBe('2026-09-28')
  })
})
