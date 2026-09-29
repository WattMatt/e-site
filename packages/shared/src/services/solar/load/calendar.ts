/**
 * Local-date calendar for the load model. SAST = UTC+2 fixed. Holidays come from the one statutory
 * source (lib/jbcc/sa-public-holidays, which projects.public_holidays materialises).
 */
import { isPublicHoliday } from '../../../lib/jbcc/sa-public-holidays'

export const HOURS_PER_YEAR = 8760
export const SAST_OFFSET_MS = 7_200_000
export type DayType = 'weekday' | 'saturday' | 'sunday' | 'holiday'
/** Gap filling pools Sundays with public holidays (engine spec §2.2). */
export type FillDayType = 'weekday' | 'saturday' | 'sunday_holiday'

const pad = (n: number) => String(n).padStart(2, '0')
export const isoDate = (y: number, m: number, d: number) => `${y}-${pad(m)}-${pad(d)}`

export function parseIsoDate(s: string): { y: number; m: number; d: number } {
  const [y, m, d] = s.split('-').map(Number)
  return { y, m, d }
}
const utcDate = (s: string) => {
  const { y, m, d } = parseIsoDate(s)
  return new Date(Date.UTC(y, m - 1, d))
}

export function addDays(s: string, n: number): string {
  const t = new Date(utcDate(s).getTime() + n * 86_400_000)
  return isoDate(t.getUTCFullYear(), t.getUTCMonth() + 1, t.getUTCDate())
}
export function daysBetween(a: string, b: string): number {
  return Math.round((utcDate(b).getTime() - utcDate(a).getTime()) / 86_400_000)
}
export const monthOf = (s: string) => parseIsoDate(s).m

const dayTypeCache = new Map<string, DayType>()
export function dayTypeOf(s: string): DayType {
  const hit = dayTypeCache.get(s)
  if (hit) return hit
  const dt = utcDate(s)
  const w = dt.getUTCDay()
  const t: DayType = isPublicHoliday(dt) ? 'holiday' : w === 0 ? 'sunday' : w === 6 ? 'saturday' : 'weekday'
  dayTypeCache.set(s, t)
  return t
}
export function fillDayTypeOf(s: string): FillDayType {
  const t = dayTypeOf(s)
  return t === 'sunday' || t === 'holiday' ? 'sunday_holiday' : t
}

export function referenceYearDates(year: number): string[] {
  const out: string[] = []
  for (let s = isoDate(year, 1, 1); s.startsWith(`${year}-`); s = addDays(s, 1)) {
    if (!s.endsWith('-02-29')) out.push(s)
  }
  return out
}

/** Local date/hour of the START of the interval ending at tsEnd. */
export function intervalStartLocal(tsEndMs: number, intervalMin: number): { date: string; hour: number; minute: number } {
  const d = new Date(tsEndMs - intervalMin * 60_000 + SAST_OFFSET_MS)
  return { date: isoDate(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate()), hour: d.getUTCHours(), minute: d.getUTCMinutes() }
}
