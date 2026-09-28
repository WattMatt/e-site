import { addDays, fillDayTypeOf, type FillDayType } from './calendar'
import type { Timeline } from './hourly'

export interface GapFillOptions {
  shortMaxHours: number
  mediumMaxHours: number
  windowDays: number
}
export const DEFAULT_GAP_FILL: GapFillOptions = { shortMaxHours: 2, mediumMaxHours: 14 * 24, windowDays: 28 }

export interface GapFillResult {
  timeline: Timeline
  /** 0 = original, 1 = linear, 2 = day-type mean. Both filled kinds are quality 2 (estimated). */
  filled: Uint8Array
  shortFilled: number
  dayTypeFilled: number
  unfilledHours: number
}

export function fillGaps(t: Timeline, opts: GapFillOptions = DEFAULT_GAP_FILL): GapFillResult {
  const src = t.values
  const n = src.length
  const out = Float64Array.from(src)
  const filled = new Uint8Array(n)
  const types = new Map<number, FillDayType>()
  const typeOf = (day: number) => {
    let v = types.get(day)
    if (!v) {
      v = fillDayTypeOf(addDays(t.startDate, day))
      types.set(day, v)
    }
    return v
  }
  let shortFilled = 0
  let dayTypeFilled = 0
  let unfilledHours = 0
  let i = 0
  while (i < n) {
    if (!Number.isNaN(src[i])) {
      i++
      continue
    }
    let j = i
    while (j < n && Number.isNaN(src[j])) j++
    const len = j - i
    if (len <= opts.shortMaxHours && i > 0 && j < n) {
      const a = src[i - 1]
      const b = src[j]
      for (let k = i; k < j; k++) {
        out[k] = a + ((b - a) * (k - (i - 1))) / (j - (i - 1))
        filled[k] = 1
      }
      shortFilled += len
    } else if (len <= opts.mediumMaxHours) {
      for (let k = i; k < j; k++) {
        const day = Math.floor(k / 24)
        const hour = k % 24
        const type = typeOf(day)
        let sum = 0
        let cnt = 0
        for (let dd = -opts.windowDays; dd <= opts.windowDays; dd++) {
          const d2 = day + dd
          if (dd === 0 || d2 < 0) continue
          const at = d2 * 24 + hour
          if (at >= n) break
          if (Number.isNaN(src[at]) || typeOf(d2) !== type) continue
          sum += src[at]
          cnt++
        }
        if (cnt > 0) {
          out[k] = sum / cnt
          filled[k] = 2
          dayTypeFilled++
        } else unfilledHours++
      }
    } else unfilledHours += len
    i = j
  }
  return { timeline: { startDate: t.startDate, values: out }, filled, shortFilled, dayTypeFilled, unfilledHours }
}
