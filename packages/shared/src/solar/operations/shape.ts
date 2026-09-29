/**
 * Expected energy inside any window, shaped by the baseline's diurnal profile: an hour's share of the
 * month is profile[hour] / (Σ profile × days in month). A zero at noon is therefore worth far more
 * than a zero at 07:00 — the opposite of WM's flat per-slot expectation (defect G14).
 * `fullKwhFor(month)` is the FULL (unprorated) month expectation from guarantee.ts.
 */
import type { OpsBaseline } from './baseline'
import { daysInMonth, monthKeyOfMs, monthParts, sastParts, type MonthKey } from './time'

const HOUR_MS = 3_600_000

export function hourShare(b: OpsBaseline, month: MonthKey, hourOfDay: number): number {
  const { year, month: m } = monthParts(month)
  const profile = b.diurnalKw[m - 1]!
  const daySum = profile.reduce((s, v) => s + v, 0)
  if (daySum <= 0) return 0
  return profile[hourOfDay]! / (daySum * daysInMonth(year, m))
}

export function expectedKwhBetween(b: OpsBaseline, fullKwhFor: (month: MonthKey) => number, startMs: number, endMs: number): number {
  let kwh = 0
  let t = startMs
  while (t < endMs) {
    // SAST is a whole-hour offset, so SAST hour boundaries are UTC hour boundaries.
    const segEnd = Math.min(endMs, (Math.floor(t / HOUR_MS) + 1) * HOUR_MS)
    const month = monthKeyOfMs(t)
    kwh += fullKwhFor(month) * hourShare(b, month, sastParts(t).hour) * ((segEnd - t) / HOUR_MS)
    t = segEnd
  }
  return kwh
}
