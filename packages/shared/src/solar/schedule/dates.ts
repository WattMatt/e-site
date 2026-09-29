/**
 * Calendar dates for the Solar schedule (functional spec §14.3).
 *
 * A task date is a Postgres `date` and travels as the 'YYYY-MM-DD' string
 * PostgREST returns. It is NEVER turned into a local-time Date: arithmetic
 * runs on UTC day numbers. WM Solar parsed dates as local midnight and wrote
 * them back with toISOString() (UTC), which moved every edited task one day
 * EARLIER in SAST (docs/solar/as-is/06 B.3.1, defect B.7 D1). ISO strings also
 * sort lexically, so `a < b` compares two CalendarDates correctly.
 */
export type CalendarDate = string

const ISO = /^(\d{4})-(\d{2})-(\d{2})$/
const MS_PER_DAY = 86_400_000
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'] as const
const pad = (n: number) => String(n).padStart(2, '0')

export function isCalendarDate(v: unknown): v is CalendarDate {
  if (typeof v !== 'string') return false
  const m = ISO.exec(v)
  if (!m) return false
  const y = Number(m[1])
  const mo = Number(m[2])
  const d = Number(m[3])
  if (y < 1900 || y > 2999) return false
  const t = new Date(Date.UTC(y, mo - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d
}

/** Days since 1970-01-01 (UTC). */
export function dayNumber(d: CalendarDate): number {
  if (!isCalendarDate(d)) throw new Error(`Not a calendar date: ${String(d)}`)
  const m = ISO.exec(d) as RegExpExecArray
  return Math.round(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) / MS_PER_DAY)
}

export function fromDayNumber(n: number): CalendarDate {
  const t = new Date(n * MS_PER_DAY)
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`
}

/** A Date that represents a UTC midnight (exceljs date cells, the holiday source) → its calendar date. */
export function calendarDateFromUtc(d: Date): CalendarDate {
  return `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`
}

export function addCalendarDays(d: CalendarDate, n: number): CalendarDate {
  return fromDayNumber(dayNumber(d) + n)
}

/** `to − from` in calendar days. */
export function daysBetween(from: CalendarDate, to: CalendarDate): number {
  return dayNumber(to) - dayNumber(from)
}

/** 0 = Sunday … 6 = Saturday. 1970-01-01 was a Thursday. */
export function weekdayOf(d: CalendarDate): number {
  return (((dayNumber(d) + 4) % 7) + 7) % 7
}

/** The Monday on or before `d` (ISO week start). */
export function mondayOf(d: CalendarDate): CalendarDate {
  return addCalendarDays(d, -((weekdayOf(d) + 6) % 7))
}

export function minCalendarDate(ds: readonly CalendarDate[]): CalendarDate | null {
  return ds.length === 0 ? null : ds.reduce((m, d) => (d < m ? d : m))
}

export function maxCalendarDate(ds: readonly CalendarDate[]): CalendarDate | null {
  return ds.length === 0 ? null : ds.reduce((m, d) => (d > m ? d : m))
}

const SAST = new Intl.DateTimeFormat('en-CA', {
  timeZone: 'Africa/Johannesburg', year: 'numeric', month: '2-digit', day: '2-digit',
})

/** Today's calendar date in South Africa, whatever the server's or browser's zone. */
export function sastToday(now: Date = new Date()): CalendarDate {
  const p = Object.fromEntries(SAST.formatToParts(now).map((x) => [x.type, x.value]))
  return `${p.year}-${p.month}-${p.day}`
}

/** An `<input type="date">` value (already 'YYYY-MM-DD') → CalendarDate, or null. */
export function parseDateInput(v: string): CalendarDate | null {
  const s = v.trim()
  return isCalendarDate(s) ? s : null
}

/** '2026-10-01' → '1 Oct 2026'. */
export function formatCalendarDate(d: CalendarDate): string {
  const [y, m, day] = d.split('-').map(Number)
  return `${day} ${MONTHS[m - 1]} ${y}`
}
