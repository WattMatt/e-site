process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import {
  saHolidaySet, saHolidays, makeWorkCalendar, isWeekendDate, isWorkingDate, spanDays, endForDuration,
  shiftDate, signedShift, nextWorkingDate,
} from './calendar'

const hol = saHolidaySet(2026, 2027)
const working = makeWorkCalendar('working', hol)
const calendar = makeWorkCalendar('calendar', hol)

describe('saHolidaySet', () => {
  it('holds the statutory 2026 days, incl. Easter and the Sunday rule', () => {
    expect(hol.has('2026-09-24')).toBe(true) // Heritage Day (Thursday)
    expect(hol.has('2026-04-03')).toBe(true) // Good Friday
    expect(hol.has('2026-04-06')).toBe(true) // Family Day
    expect(hol.has('2026-08-10')).toBe(true) // Women's Day (Sun 9 Aug) observed Monday
    expect(hol.has('2026-09-25')).toBe(false)
  })
})

describe('working-day checks', () => {
  it('weekends and holidays are non-working only in working mode', () => {
    expect(isWeekendDate('2026-09-26')).toBe(true)
    expect(isWorkingDate(working, '2026-09-26')).toBe(false)
    expect(isWorkingDate(working, '2026-09-24')).toBe(false)
    expect(isWorkingDate(working, '2026-09-25')).toBe(true)
    expect(isWorkingDate(calendar, '2026-09-26')).toBe(true)
    expect(nextWorkingDate(working, '2026-09-26')).toBe('2026-09-28')
  })
})

describe('spanDays (inclusive)', () => {
  it('counts working days across Heritage Day', () => {
    expect(spanDays(working, '2026-09-21', '2026-09-25')).toBe(4)
    expect(spanDays(calendar, '2026-09-21', '2026-09-25')).toBe(5)
  })
  it('a same-day task is one day; an inverted span is zero', () => {
    expect(spanDays(calendar, '2026-10-01', '2026-10-01')).toBe(1)
    expect(spanDays(working, '2026-10-02', '2026-10-01')).toBe(0)
  })
})

describe('endForDuration', () => {
  it('working: 3 days from Wed 23 Sep skip Heritage Day and the weekend', () => {
    expect(endForDuration(working, '2026-09-23', 3)).toBe('2026-09-28')
    expect(endForDuration(calendar, '2026-09-23', 3)).toBe('2026-09-25')
  })
  it('working: a start on Saturday begins on Monday', () => {
    expect(endForDuration(working, '2026-09-26', 1)).toBe('2026-09-28')
  })
  it('refuses a duration below one day', () => {
    expect(() => endForDuration(working, '2026-09-23', 0)).toThrow('at least 1')
  })
})

describe('shiftDate and signedShift', () => {
  it('working shifts step over weekends and holidays in both directions', () => {
    expect(shiftDate(working, '2026-09-25', 1)).toBe('2026-09-28')
    expect(shiftDate(working, '2026-09-28', -1)).toBe('2026-09-25')
    expect(shiftDate(working, '2026-09-25', -1)).toBe('2026-09-23')
    expect(shiftDate(calendar, '2026-09-25', 3)).toBe('2026-09-28')
  })
  it('signedShift measures slip in the calendar’s units', () => {
    expect(signedShift(working, '2026-09-23', '2026-09-28')).toBe(2)
    expect(signedShift(working, '2026-09-28', '2026-09-23')).toBe(-2)
    expect(signedShift(calendar, '2026-09-23', '2026-09-28')).toBe(5)
    expect(signedShift(calendar, '2026-09-23', '2026-09-23')).toBe(0)
  })
})

describe('saHolidays — looked up lazily per year', () => {
  it('a task in a year nobody asked for still skips its holidays (Freedom Day and Workers’ Day 2028)', () => {
    const cal = makeWorkCalendar('working', saHolidays())
    // Mon 24 Apr 2028 + 5 working days: 24, 25, 26, (Thu 27 Freedom Day), 28, (weekend), (Mon 1 May Workers’ Day), Tue 2 May.
    expect(endForDuration(cal, '2028-04-24', 5)).toBe('2028-05-02')
    expect(spanDays(cal, '2028-04-24', '2028-05-02')).toBe(5)
  })
  it('works for a far year and for 2026 alike', () => {
    const h = saHolidays()
    expect(h.has('2045-12-16')).toBe(true)
    expect(h.has('2045-12-17')).toBe(false)
    expect(h.has('2026-09-24')).toBe(true)
    expect(h.has('not-a-date')).toBe(false)
  })
})
