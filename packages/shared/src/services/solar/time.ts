/**
 * Time base (engine spec §1.2, fixed): a reference year of 8,760 hours, no 29 February.
 * Hour index 0 = 01 Jan 00:00–01:00 SAST (UTC+2, no DST). Values are interval averages:
 * `x[h]` is the mean over [h, h+1).
 */

export const HOURS_PER_YEAR = 8760
export const SAST_OFFSET_HOURS = 2
/**
 * Calendar year used ONLY to place the sun (solar geometry). Any non-leap year gives the
 * same answer to well under 0.01° of declination; it is fixed so runs are reproducible.
 */
export const GEOMETRY_YEAR = 2025
export const DAYS_IN_MONTH: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

const MONTH_START_DAY: readonly number[] = DAYS_IN_MONTH.reduce<number[]>(
  (acc, _d, i) => (i === 0 ? [0] : [...acc, acc[i - 1]! + DAYS_IN_MONTH[i - 1]!]),
  [],
)

/** 0-based day of year (non-leap) for month 1–12 and day 1–31. */
export function dayOfYear0(month: number, day: number): number {
  if (!Number.isInteger(month) || month < 1 || month > 12) throw new Error(`month out of range: ${month}`)
  const dim = DAYS_IN_MONTH[month - 1]!
  if (!Number.isInteger(day) || day < 1 || day > dim) throw new Error(`day out of range: ${month}/${day}`)
  return MONTH_START_DAY[month - 1]! + day - 1
}

/** Month (1–12) of a SAST hour index. */
export function monthOfHour(h: number): number {
  const day = Math.floor(h / 24)
  let m = 0
  while (m < 11 && day >= MONTH_START_DAY[m + 1]!) m++
  return m + 1
}

/** [start, end) hour indices of each month, January first. */
export function monthHourRanges(): { month: number; start: number; end: number }[] {
  return DAYS_IN_MONTH.map((dim, i) => ({
    month: i + 1,
    start: MONTH_START_DAY[i]! * 24,
    end: (MONTH_START_DAY[i]! + dim) * 24,
  }))
}

/** UTC epoch ms at the START of SAST hour h in GEOMETRY_YEAR. */
export function sastHourStartUtcMs(h: number): number {
  return Date.UTC(GEOMETRY_YEAR, 0, 1) + (h - SAST_OFFSET_HOURS) * 3_600_000
}

/** Sum an 8760 series into 12 monthly totals. */
export function monthlySums(series: ArrayLike<number>): number[] {
  assert8760(series, 'series')
  return monthHourRanges().map(({ start, end }) => {
    let s = 0
    for (let h = start; h < end; h++) s += series[h]!
    return s
  })
}

export function assert8760(series: ArrayLike<number>, name: string): void {
  if (series.length !== HOURS_PER_YEAR) {
    throw new Error(`${name} must have ${HOURS_PER_YEAR} hourly values, got ${series.length}`)
  }
}

export function sum(series: ArrayLike<number>): number {
  let s = 0
  for (let i = 0; i < series.length; i++) s += series[i]!
  return s
}
