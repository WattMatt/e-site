import { isUsable, type Reading } from '../../../meter-data/types'
import { addDays, daysBetween, intervalStartLocal } from './calendar'

/** Local date → 24 hourly average kW values; NaN = missing. */
export type DailyHours = Map<string, Float64Array>
/** A contiguous hourly series from startDate 00:00; length = days × 24. */
export interface Timeline {
  startDate: string
  values: Float64Array
}

export function readingsToDailyHours(readings: Reading[], intervalMin: number): DailyHours {
  if (intervalMin > 60 || 60 % intervalMin !== 0) {
    throw new Error(`readingsToDailyHours: a ${intervalMin}-min interval cannot build an hourly series`)
  }
  const per = 60 / intervalMin
  const acc = new Map<string, { sum: Float64Array; n: Uint8Array }>()
  for (const r of readings) {
    if (!isUsable(r)) continue
    const { date, hour } = intervalStartLocal(r.tsEnd, intervalMin)
    let e = acc.get(date)
    if (!e) {
      e = { sum: new Float64Array(24), n: new Uint8Array(24) }
      acc.set(date, e)
    }
    e.sum[hour] += r.value as number
    e.n[hour] += 1
  }
  const out: DailyHours = new Map()
  for (const date of [...acc.keys()].sort()) {
    const e = acc.get(date) as { sum: Float64Array; n: Uint8Array }
    const v = new Float64Array(24).fill(NaN)
    for (let h = 0; h < 24; h++) if (e.n[h] === per) v[h] = e.sum[h] / per
    out.set(date, v)
  }
  return out
}

export function completeDays(d: DailyHours): string[] {
  return [...d.entries()].filter(([, v]) => v.every((x) => !Number.isNaN(x))).map(([k]) => k).sort()
}

export function toTimeline(d: DailyHours): Timeline | null {
  const dates = [...d.keys()].sort()
  if (dates.length === 0) return null
  const startDate = dates[0]
  const n = daysBetween(startDate, dates[dates.length - 1]) + 1
  const values = new Float64Array(n * 24).fill(NaN)
  for (const [date, v] of d) values.set(v, daysBetween(startDate, date) * 24)
  return { startDate, values }
}

export function fromTimeline(t: Timeline): DailyHours {
  const out: DailyHours = new Map()
  for (let day = 0; day * 24 < t.values.length; day++) out.set(addDays(t.startDate, day), t.values.slice(day * 24, day * 24 + 24))
  return out
}
