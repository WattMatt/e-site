/**
 * Lost energy during a downtime window (spec §10 monthly report: "downtime table with lost kWh and lost
 * revenue"): per interval, the SHAPED expectation (shape.ts) minus what the meter recorded, clipped at
 * zero. The step is the data's own interval (default 30 min when the window has no data at all). The
 * hourly series places each step's loss on the bill engine's 365-day hour index so the pinned
 * tariff's TOU calendar values it (lost-revenue.ts in the web app).
 */
import type { OpsBaseline } from './baseline'
import type { SeriesPoint, TimeWindow } from './downtime-detect'
import { expectedKwhBetween } from './shape'
import { sastParts, type MonthKey } from './time'

export interface LostStep { startMs: number; endMs: number; expectedKwh: number; actualKwh: number; lostKwh: number }

const r6 = (x: number) => Math.round(x * 1e6) / 1e6

function dominantInterval(points: readonly SeriesPoint[], fallback: number): number {
  const count = new Map<number, number>()
  for (const p of points) count.set(p.intervalMin, (count.get(p.intervalMin) ?? 0) + 1)
  let best = fallback
  let n = 0
  for (const [k, v] of count) if (v > n) { best = k; n = v }
  return best
}

export function lostSteps(
  w: TimeWindow,
  points: readonly SeriesPoint[],
  b: OpsBaseline,
  fullKwhFor: (month: MonthKey) => number,
  defaultIntervalMin = 30,
): LostStep[] {
  const inside = points.filter((p) => p.endMs > w.startMs && p.endMs - p.intervalMin * 60_000 < w.endMs)
  const stepMs = dominantInterval(inside, defaultIntervalMin) * 60_000
  const byEnd = new Map(inside.map((p) => [p.endMs, p.kw]))
  const out: LostStep[] = []
  for (let t = w.startMs; t < w.endMs; t += stepMs) {
    const segEnd = Math.min(t + stepMs, w.endMs)
    const expectedKwh = expectedKwhBetween(b, fullKwhFor, t, segEnd)
    const kw = byEnd.get(t + stepMs)
    const actualKwh = kw === undefined ? 0 : (kw * (segEnd - t)) / 3_600_000
    out.push({ startMs: t, endMs: segEnd, expectedKwh: r6(expectedKwh), actualKwh: r6(actualKwh), lostKwh: r6(Math.max(0, expectedKwh - actualKwh)) })
  }
  return out
}

export function lostKwh(steps: readonly LostStep[]): number {
  return r6(steps.reduce((s, x) => s + x.lostKwh, 0))
}

const MONTH_START_DAY = [0, 31, 59, 90, 120, 151, 181, 212, 243, 273, 304, 334]

/** SAST hour-of-year on a 365-day year (the bill engine's 8760 index; 29 Feb folds onto 28 Feb). */
export function referenceHourIndex(ms: number): number {
  const p = sastParts(ms)
  const day = p.month === 2 && p.day === 29 ? 28 : p.day
  return (MONTH_START_DAY[p.month - 1]! + day - 1) * 24 + p.hour
}

export function lostHourlyKwh(steps: readonly LostStep[]): Float64Array {
  const out = new Float64Array(8760)
  for (const s of steps) out[referenceHourIndex(s.startMs)] = out[referenceHourIndex(s.startMs)]! + s.lostKwh
  return out
}
