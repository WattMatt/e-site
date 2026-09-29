/**
 * Lost energy during a downtime window (spec §10 monthly report: "downtime table with lost kWh and lost
 * revenue"): per interval, the SHAPED expectation (shape.ts) minus what the meter recorded, clipped at
 * zero. The step is the data's own interval (default 30 min when the window has no data at all); what
 * the meters recorded is counted by overlap with each step, so neither the step grid nor the window
 * has to line up with the data. The
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
  const n = Math.ceil((w.endMs - w.startMs) / stepMs)
  // Actual energy per step by OVERLAP (review B2): every point covers [end - interval, end) and adds
  // kW × the hours it shares with each step. A window off the data grid still sees its output, and
  // points sharing an end time (meters on different intervals) are summed, never collapsed.
  const actualKwhMs = new Float64Array(n)
  for (const p of inside) {
    const s0 = Math.max(p.endMs - p.intervalMin * 60_000, w.startMs)
    const s1 = Math.min(p.endMs, w.endMs)
    for (let k = Math.floor((s0 - w.startMs) / stepMs); k < n; k++) {
      const t0 = w.startMs + k * stepMs
      if (t0 >= s1) break
      const ov = Math.min(s1, t0 + stepMs, w.endMs) - Math.max(s0, t0)
      if (ov > 0) actualKwhMs[k] = actualKwhMs[k]! + p.kw * ov
    }
  }
  const out: LostStep[] = []
  for (let k = 0; k < n; k++) {
    const t = w.startMs + k * stepMs
    const segEnd = Math.min(t + stepMs, w.endMs)
    const expectedKwh = expectedKwhBetween(b, fullKwhFor, t, segEnd)
    const actualKwh = actualKwhMs[k]! / 3_600_000
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
