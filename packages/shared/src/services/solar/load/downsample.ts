/**
 * Meter-chart data prepared on the server (functional spec §4.3 detail drawer): a zoomed-out window is
 * sent as min/max/mean buckets so a spike is never averaged away; a zoomed-in window (≤ the bucket
 * count) is sent at full resolution. Gaps are shaded from explicit ranges. The heatmap is day ×
 * hour of local time.
 */
import type { Reading } from '../../../meter-data/types'
import { addDays } from './calendar'
import { readingsToDailyHours } from './hourly'

export interface Bucket { t0: number; t1: number; min: number | null; max: number | null; mean: number | null }

export function minMaxBuckets(ts: number[], values: Array<number | null>, count: number): Bucket[] {
  if (ts.length !== values.length) throw new RangeError('minMaxBuckets: ts and values differ in length')
  if (ts.length === 0) return []
  if (ts.length <= count) return ts.map((t, i) => ({ t0: t, t1: t, min: values[i], max: values[i], mean: values[i] }))
  const t0 = ts[0]
  const w = (ts[ts.length - 1] - t0) / count
  const out: Bucket[] = Array.from({ length: count }, (_, b) => ({ t0: t0 + b * w, t1: t0 + (b + 1) * w, min: null, max: null, mean: null }))
  const sums = new Float64Array(count)
  const ns = new Uint32Array(count)
  for (let i = 0; i < ts.length; i++) {
    const v = values[i]
    if (v === null || !Number.isFinite(v)) continue
    const b = Math.min(count - 1, Math.floor((ts[i] - t0) / w))
    const o = out[b]
    o.min = o.min === null ? v : Math.min(o.min, v)
    o.max = o.max === null ? v : Math.max(o.max, v)
    sums[b] += v
    ns[b]++
  }
  for (let b = 0; b < count; b++) out[b].mean = ns[b] > 0 ? sums[b] / ns[b] : null
  return out
}

/** Ranges (ms) with no usable value: missing slots between readings, and null values. */
export function gapRanges(ts: number[], values: Array<number | null>, intervalMin: number): Array<{ from: number; to: number }> {
  const step = intervalMin * 60_000
  const out: Array<{ from: number; to: number }> = []
  const push = (from: number, to: number) => {
    const last = out[out.length - 1]
    if (last && from <= last.to) last.to = Math.max(last.to, to)
    else out.push({ from, to })
  }
  for (let i = 0; i < ts.length; i++) {
    if (i > 0 && ts[i] - ts[i - 1] > step * 1.5) push(ts[i - 1], ts[i] - step)
    if (values[i] === null) push(ts[i] - step, ts[i])
  }
  return out
}

export interface DailyHeatmap { dates: string[]; cells: Array<Array<number | null>> }

/** Local date × hour average kW; every date between the first and last is present (null = no data). */
export function dailyHeatmap(readings: Reading[], intervalMin: number): DailyHeatmap {
  const d = readingsToDailyHours(readings, intervalMin)
  const known = [...d.keys()].sort()
  if (known.length === 0) return { dates: [], cells: [] }
  const dates: string[] = []
  for (let s = known[0]; s <= known[known.length - 1]; s = addDays(s, 1)) dates.push(s)
  return {
    dates,
    cells: dates.map((k) => {
      const v = d.get(k)
      return v ? Array.from(v, (x) => (Number.isNaN(x) ? null : x)) : Array(24).fill(null)
    }),
  }
}
