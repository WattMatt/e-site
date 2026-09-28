/**
 * Working-day calendar for the Solar schedule (spec §14.3 "optional working
 * days only duration mode"). `calendar` mode counts every day; `working` mode
 * counts Monday–Friday excluding SA public holidays. Holidays come from the
 * statutory source `listHolidaysNamed()` that projects.public_holidays (00194)
 * materialises, so the Gantt skips the same days the work-item due-date
 * trigger does. WM Solar had no working days and no holidays (as-is/06 B.3.1).
 */
import { listHolidaysNamed } from '../../lib/jbcc/sa-public-holidays'
import { addCalendarDays, calendarDateFromUtc, daysBetween, weekdayOf, type CalendarDate } from './dates'

export const DURATION_MODES = ['calendar', 'working'] as const
export type DurationMode = (typeof DURATION_MODES)[number]

export interface WorkCalendar {
  readonly mode: DurationMode
  readonly holidays: ReadonlySet<CalendarDate>
}

const LIMIT = 40_000 // ~110 years of days; a loop that runs longer is a bug

export function saHolidaySet(fromYear: number, toYear: number): Set<CalendarDate> {
  const out = new Set<CalendarDate>()
  for (let y = fromYear; y <= toYear; y++) {
    for (const h of listHolidaysNamed(y)) out.add(calendarDateFromUtc(h.date))
  }
  return out
}

export function makeWorkCalendar(mode: DurationMode, holidays: ReadonlySet<CalendarDate> = new Set()): WorkCalendar {
  return { mode, holidays }
}

export function isWeekendDate(d: CalendarDate): boolean {
  const w = weekdayOf(d)
  return w === 0 || w === 6
}

export function isWorkingDate(cal: WorkCalendar, d: CalendarDate): boolean {
  return cal.mode === 'calendar' || (!isWeekendDate(d) && !cal.holidays.has(d))
}

export function nextWorkingDate(cal: WorkCalendar, d: CalendarDate): CalendarDate {
  let c = d
  for (let i = 0; i < LIMIT; i++) {
    if (isWorkingDate(cal, c)) return c
    c = addCalendarDays(c, 1)
  }
  throw new Error('No working day found')
}

/** Inclusive length of start..end in the calendar's units (0 when end < start). */
export function spanDays(cal: WorkCalendar, start: CalendarDate, end: CalendarDate): number {
  if (end < start) return 0
  if (cal.mode === 'calendar') return daysBetween(start, end) + 1
  let n = 0
  for (let c = start; c <= end; c = addCalendarDays(c, 1)) if (isWorkingDate(cal, c)) n++
  return n
}

/** The inclusive end date of a task of `days` units starting at `start`. */
export function endForDuration(cal: WorkCalendar, start: CalendarDate, days: number): CalendarDate {
  if (!Number.isInteger(days) || days < 1) throw new Error('A duration is a whole number of days, at least 1')
  if (cal.mode === 'calendar') return addCalendarDays(start, days - 1)
  let c = nextWorkingDate(cal, start)
  let left = days - 1
  while (left > 0) {
    c = addCalendarDays(c, 1)
    if (isWorkingDate(cal, c)) left--
  }
  return c
}

/** Move `d` by `n` units (negative = earlier). Working mode lands on working days. */
export function shiftDate(cal: WorkCalendar, d: CalendarDate, n: number): CalendarDate {
  if (cal.mode === 'calendar' || n === 0) return addCalendarDays(d, n)
  const step = n > 0 ? 1 : -1
  let left = Math.abs(n)
  let c = d
  while (left > 0) {
    c = addCalendarDays(c, step)
    if (isWorkingDate(cal, c)) left--
  }
  return c
}

/** Signed distance from `from` to `to` in the calendar's units (positive = later = slip). */
export function signedShift(cal: WorkCalendar, from: CalendarDate, to: CalendarDate): number {
  if (from === to) return 0
  if (cal.mode === 'calendar') return daysBetween(from, to)
  const later = to > from
  const lo = later ? from : to
  const hi = later ? to : from
  let n = 0
  for (let c = addCalendarDays(lo, 1); c <= hi; c = addCalendarDays(c, 1)) if (isWorkingDate(cal, c)) n++
  return later ? n : -n
}
