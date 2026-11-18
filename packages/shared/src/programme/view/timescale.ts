import {
  addCalendarDays, daysBetween, fromDayNumber, dayNumber, mondayOf, type CalendarDate,
} from '../../lib/dates/calendar-date'

export type Zoom = 'day' | 'week' | 'month' | 'quarter' | 'year'
export const DAY_WIDTH: Record<Zoom, number> = { day: 36, week: 14, month: 4, quarter: 1.5, year: 0.5 }
export const ROW_HEIGHT = 28
export const HEADER_HEIGHT = 44
const PAD_DAYS = 7
const MIN_BAR = 2
const MON = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const

export interface Band { x: number; width: number; label: string }
export interface Timescale {
  origin: CalendarDate
  width: number
  dayWidth: number
  bands: { top: Band[]; bottom: Band[] }
}

const parts = (d: CalendarDate) => ({ y: Number(d.slice(0, 4)), m: Number(d.slice(5, 7)), d: Number(d.slice(8, 10)) })
const iso = (y: number, m: number, d: number): CalendarDate =>
  `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`

function monthStart(d: CalendarDate): CalendarDate { const p = parts(d); return iso(p.y, p.m, 1) }
function nextMonth(d: CalendarDate): CalendarDate { const p = parts(d); return p.m === 12 ? iso(p.y + 1, 1, 1) : iso(p.y, p.m + 1, 1) }
function quarterStart(d: CalendarDate): CalendarDate { const p = parts(d); return iso(p.y, Math.floor((p.m - 1) / 3) * 3 + 1, 1) }
function nextQuarter(d: CalendarDate): CalendarDate { const p = parts(d); return p.m >= 10 ? iso(p.y + 1, 1, 1) : iso(p.y, p.m + 3, 1) }
function yearStart(d: CalendarDate): CalendarDate { return iso(parts(d).y, 1, 1) }
function nextYear(d: CalendarDate): CalendarDate { return iso(parts(d).y + 1, 1, 1) }

/** Bands covering [origin, endExcl): each starts at its natural boundary, clipped to the range. */
function build(
  origin: CalendarDate, endExcl: CalendarDate, dw: number, first: (d: CalendarDate) => CalendarDate,
  next: (d: CalendarDate) => CalendarDate, label: (start: CalendarDate) => string,
): Band[] {
  const out: Band[] = []
  for (let s = first(origin); s < endExcl; s = next(s)) {
    const from = s < origin ? origin : s
    const to = next(s) < endExcl ? next(s) : endExcl
    out.push({ x: daysBetween(origin, from) * dw, width: daysBetween(from, to) * dw, label: label(s) })
  }
  return out
}

const monthYear = (d: CalendarDate) => `${MON[parts(d).m - 1]} ${parts(d).y}`
const monthOnly = (d: CalendarDate) => MON[parts(d).m - 1]
const yearOnly = (d: CalendarDate) => String(parts(d).y)
const quarterOf = (d: CalendarDate) => `Q${Math.floor((parts(d).m - 1) / 3) + 1}`
const weekLabel = (d: CalendarDate) => `${String(parts(d).d).padStart(2, '0')} ${MON[parts(d).m - 1]}`
const dayOfMonth = (d: CalendarDate) => String(parts(d).d)

/** Pixel scale for [start, end] (inclusive), padded by 7 days each side, with the header bands for `zoom`. */
export function timescale(start: CalendarDate, end: CalendarDate, zoom: Zoom): Timescale {
  const origin = addCalendarDays(start, -PAD_DAYS)
  const last = addCalendarDays(end < start ? start : end, PAD_DAYS)
  const endExcl = addCalendarDays(last, 1)
  const dayWidth = DAY_WIDTH[zoom]
  const width = daysBetween(origin, endExcl) * dayWidth
  const day = (d: CalendarDate) => d
  const nextDay = (d: CalendarDate) => addCalendarDays(d, 1)
  const nextWeek = (d: CalendarDate) => addCalendarDays(d, 7)

  let top: Band[] = []
  let bottom: Band[]
  switch (zoom) {
    case 'day':
      top = build(origin, endExcl, dayWidth, monthStart, nextMonth, monthYear)
      bottom = build(origin, endExcl, dayWidth, day, nextDay, dayOfMonth)
      break
    case 'week':
      top = build(origin, endExcl, dayWidth, monthStart, nextMonth, monthYear)
      bottom = build(origin, endExcl, dayWidth, mondayOf, nextWeek, weekLabel)
      break
    case 'month':
      top = build(origin, endExcl, dayWidth, yearStart, nextYear, yearOnly)
      bottom = build(origin, endExcl, dayWidth, monthStart, nextMonth, monthOnly)
      break
    case 'quarter':
      top = build(origin, endExcl, dayWidth, yearStart, nextYear, yearOnly)
      bottom = build(origin, endExcl, dayWidth, quarterStart, nextQuarter, quarterOf)
      break
    case 'year':
      bottom = build(origin, endExcl, dayWidth, yearStart, nextYear, yearOnly)
      break
  }
  return { origin, width, dayWidth, bands: { top, bottom } }
}

/** x of the START of `date`'s day. */
export function xOfDate(scale: Pick<Timescale, 'origin' | 'dayWidth'>, date: CalendarDate): number {
  return daysBetween(scale.origin, date) * scale.dayWidth
}

/** The day that contains pixel `x`. */
export function dateAtX(scale: Pick<Timescale, 'origin' | 'dayWidth'>, x: number): CalendarDate {
  return fromDayNumber(dayNumber(scale.origin) + Math.floor(x / scale.dayWidth))
}

/**
 * Bar geometry for [start, finish]. A finish is inclusive, so the width is (finish − start + 1) days,
 * at least 2 px. A milestone is a 0-width point at `start`.
 */
export function barX(
  scale: Pick<Timescale, 'origin' | 'dayWidth'>, start: CalendarDate, finish: CalendarDate, milestone = false,
): { x: number; width: number } {
  const x = xOfDate(scale, start)
  if (milestone) return { x, width: 0 }
  return { x, width: Math.max(MIN_BAR, (daysBetween(start, finish) + 1) * scale.dayWidth) }
}
