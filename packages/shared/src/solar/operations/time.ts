/**
 * Calendar helpers for Operations. Every month boundary is SAST (UTC+2, no DST), the same rule the
 * SQL aggregation uses (`AT TIME ZONE 'Africa/Johannesburg'`). An interval belongs to the month its
 * START falls in — never to a month chosen in the UI (WM defect G4).
 */
export const SAST_OFFSET_MS = 2 * 3_600_000
export type MonthKey = string

const MONTH_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DATE_RE = /^(\d{4})-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/
export const MONTH_NAMES = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
] as const

export function isMonthKey(s: unknown): s is MonthKey {
  return typeof s === 'string' && MONTH_RE.test(s)
}

export function monthParts(k: MonthKey): { year: number; month: number } {
  const m = MONTH_RE.exec(k)
  if (!m) throw new Error(`not a month key: ${k}`)
  return { year: Number(m[1]), month: Number(m[2]) }
}

export function monthKey(year: number, month: number): MonthKey {
  return `${year}-${String(month).padStart(2, '0')}`
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate()
}

export function addMonths(k: MonthKey, n: number): MonthKey {
  const { year, month } = monthParts(k)
  const idx = year * 12 + (month - 1) + n
  const y = Math.floor(idx / 12)
  return monthKey(y, idx - y * 12 + 1)
}

export function monthsBetween(a: MonthKey, b: MonthKey): number {
  const pa = monthParts(a)
  const pb = monthParts(b)
  return (pb.year - pa.year) * 12 + (pb.month - pa.month)
}

/** Inclusive; empty when `to` is before `from`. */
export function monthRange(from: MonthKey, to: MonthKey): MonthKey[] {
  const n = monthsBetween(from, to)
  return n < 0 ? [] : Array.from({ length: n + 1 }, (_, i) => addMonths(from, i))
}

/** UTC epoch ms of SAST midnight on the 1st of the month. */
export function monthStartMs(k: MonthKey): number {
  const { year, month } = monthParts(k)
  return Date.UTC(year, month - 1, 1) - SAST_OFFSET_MS
}

export function monthEndMs(k: MonthKey): number {
  return monthStartMs(addMonths(k, 1))
}

export interface SastParts { year: number; month: number; day: number; hour: number; minute: number }

export function sastParts(ms: number): SastParts {
  const d = new Date(ms + SAST_OFFSET_MS)
  return { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate(), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}

export function monthKeyOfMs(ms: number): MonthKey {
  const p = sastParts(ms)
  return monthKey(p.year, p.month)
}

/** 'YYYY-MM-DD' → UTC epoch ms of SAST midnight that day. */
export function sastMidnightMs(isoDate: string): number {
  const m = DATE_RE.exec(isoDate)
  if (!m) throw new Error(`not a date: ${isoDate}`)
  return Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])) - SAST_OFFSET_MS
}

/** 'YYYY-MM-DD' → its month key. */
export function dateMonthKey(isoDate: string): MonthKey {
  if (!DATE_RE.test(isoDate)) throw new Error(`not a date: ${isoDate}`)
  return isoDate.slice(0, 7)
}

export function monthLabel(k: MonthKey): string {
  const { year, month } = monthParts(k)
  return `${MONTH_NAMES[month - 1]} ${year}`
}

/** 'YYYY-MM' → 'YYYY-MM-01' (the DATE the database stores for a month). */
export function monthFirstDay(k: MonthKey): string {
  monthParts(k)
  return `${k}-01`
}

const LOCAL_RE = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/

/** A `<input type="datetime-local">` value read as SAST → ISO UTC, or null when malformed. */
export function sastLocalToIso(local: string): string | null {
  const m = LOCAL_RE.exec(local)
  if (!m) return null
  const [y, mo, d, h, mi] = m.slice(1).map(Number) as [number, number, number, number, number]
  const ms = Date.UTC(y, mo - 1, d, h, mi) - SAST_OFFSET_MS
  const back = sastParts(ms)
  if (back.year !== y || back.month !== mo || back.day !== d || back.hour !== h || back.minute !== mi) return null
  return new Date(ms).toISOString()
}

/** ISO → the SAST `datetime-local` value ('YYYY-MM-DDTHH:mm'). */
export function isoToSastLocal(iso: string): string {
  return new Date(Date.parse(iso) + SAST_OFFSET_MS).toISOString().slice(0, 16)
}
