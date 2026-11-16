import { dayNumber, fromDayNumber } from '../lib/dates/calendar-date'
import { buildCalendar, type CalendarInput } from '../lib/calendar/working-days'
import type { CalendarDate, EngineCalendarSpec, Instant } from './types'

export interface EngineCalendar {
  readonly id: string
  isWorkingDay(day: number): boolean
  /** Working position of an instant (monotone, non-decreasing). */
  workPos(t: Instant): number
  /** Inverse of workPos. 'start': a whole position lands at the START of that working day;
   *  'finish': a whole position lands at the END of the previous working day (a day boundary). */
  fromWorkPos(pos: number, mode: 'start' | 'finish'): Instant
  addWork(t: Instant, n: number, mode: 'start' | 'finish'): Instant
  workBetween(a: Instant, b: Instant): number
  /** Earliest working instant >= t. */
  snapStart(t: Instant): Instant
  inCoverage(t: Instant): boolean
}

const PAD_DAYS = 400
const CHUNK = 366
const EPS = 1e-9

export function buildEngineCalendar(spec: EngineCalendarSpec): EngineCalendar {
  const weekdays = new Set(spec.workWeekdays)
  const nonWork = new Set(spec.nonWorkDates.map(dayNumber))
  const extraWork = new Set(spec.workDates.map(dayNumber))
  const covFrom = dayNumber(spec.coverage.from)
  const covTo = dayNumber(spec.coverage.to)
  if (weekdays.size === 0) {
    throw new Error(`Calendar ${spec.id} has no working weekdays`)
  }

  const isoWeekday = (day: number) => ((((day + 3) % 7) + 7) % 7) + 1 // 1970-01-01 is a Thursday (4)

  function isWorkingDay(day: number): boolean {
    if (day >= covFrom && day <= covTo) {
      if (nonWork.has(day)) return false
      if (extraWork.has(day)) return true
    }
    return weekdays.has(isoWeekday(day))
  }

  // cum[i] = working days in [origin, lo + i), signed (negative below origin).
  const origin = covFrom - PAD_DAYS
  let lo = origin
  let cum: number[] = [0]

  function extendUp(): void {
    let hi = lo + cum.length - 1
    let c = cum[cum.length - 1]
    for (let k = 0; k < CHUNK; k++) {
      if (isWorkingDay(hi)) c++
      hi++
      cum.push(c)
    }
  }
  function extendDown(): void {
    const add: number[] = []
    let c = cum[0]
    let d = lo
    for (let k = 0; k < CHUNK; k++) {
      d--
      if (isWorkingDay(d)) c--
      add.push(c)
    }
    add.reverse()
    cum = add.concat(cum)
    lo -= CHUNK
  }
  /** Make cum cover [dayLo, dayHi] (index dayHi - lo + 1 must exist). */
  function ensureDays(dayLo: number, dayHi: number): void {
    while (dayLo < lo) extendDown()
    while (dayHi + 1 - lo >= cum.length) extendUp()
  }
  const cumAt = (day: number): number => {
    ensureDays(day, day)
    return cum[day - lo]
  }

  function workPos(t: Instant): number {
    const d = Math.floor(t)
    return cumAt(d) + (isWorkingDay(d) ? t - d : 0)
  }

  function fromWorkPos(pos: number, mode: 'start' | 'finish'): Instant {
    pos = Math.round(pos * 1e9) / 1e9
    const w = Math.floor(pos + EPS)
    const frac = pos - w
    // make sure the searched range surely contains the answer
    while (cum[0] > w - 2) extendDown()
    while (cum[cum.length - 1] < w + 2) extendUp()
    // smallest index j with cum[j] >= target
    const firstAtLeast = (target: number): number => {
      let a = 0
      let b = cum.length - 1
      while (a < b) {
        const m = (a + b) >> 1
        if (cum[m] >= target) b = m
        else a = m + 1
      }
      return a
    }
    if (frac > EPS) {
      // inside the (w+1)th working day: smallest D with cum[D+1] > w
      const D = lo + firstAtLeast(w + 1) - 1
      return D + frac
    }
    if (mode === 'start') {
      const D = lo + firstAtLeast(w + 1) - 1
      return D
    }
    // finish: end of the w-th working day = smallest E with cum[E+1] >= w, boundary E+1
    return lo + firstAtLeast(w)
  }

  function snapStart(t: Instant): Instant {
    let d = Math.floor(t)
    if (isWorkingDay(d)) return t
    do d++
    while (!isWorkingDay(d))
    return d
  }

  return {
    id: spec.id,
    isWorkingDay,
    workPos,
    fromWorkPos,
    addWork: (t, n, mode) => fromWorkPos(workPos(t) + n, mode),
    workBetween: (a, b) => workPos(b) - workPos(a),
    snapStart,
    inCoverage: t => {
      const d = Math.floor(t)
      return d >= covFrom && d <= covTo
    },
  }
}

export function engineCalendarFromProject(
  id: string,
  input: CalendarInput,
  hoursPerDay: number,
  coverage: { from: CalendarDate; to: CalendarDate },
): EngineCalendarSpec {
  const cal = buildCalendar(input)
  const nonWork = new Set<CalendarDate>([...input.holidays, ...input.extraHolidays])
  if (input.shutdown) {
    const from = dayNumber(input.shutdown.from)
    const to = dayNumber(input.shutdown.to)
    for (let d = from; d <= to; d++) nonWork.add(fromDayNumber(d))
  }
  return {
    id,
    workWeekdays: [...cal.effectiveDays],
    hoursPerDay,
    nonWorkDates: [...nonWork],
    workDates: [],
    coverage,
  }
}

export function startOf(d: CalendarDate): Instant {
  return dayNumber(d)
}

export function displayStart(t: Instant): CalendarDate {
  return fromDayNumber(Math.floor(t))
}

/** Whole t → last working day strictly before day t; otherwise the day containing t. */
export function displayFinish(cal: EngineCalendar, t: Instant): CalendarDate {
  const r = Math.round(t * 1e9) / 1e9
  if (Number.isInteger(r)) {
    let d = r - 1
    while (!cal.isWorkingDay(d)) d--
    return fromDayNumber(d)
  }
  return fromDayNumber(Math.floor(r))
}
