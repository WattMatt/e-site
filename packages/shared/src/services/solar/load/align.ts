import { addDays, dayTypeOf, HOURS_PER_YEAR, monthOf, parseIsoDate, referenceYearDates } from './calendar'
import type { DailyHours } from './hourly'

export interface SourceWindow {
  start: string
  end: string
}

/** The most recent `days` days ending at the latest date (engine spec §2.2 default). */
export function latestWindow(dates: string[], days = 365): SourceWindow | null {
  if (dates.length === 0) return null
  const end = [...dates].sort()[dates.length - 1]
  return { start: addDays(end, -(days - 1)), end }
}

export interface AlignResult {
  series: Float64Array
  mapping: Array<{ target: string; source: string | null }>
  unmappedDays: number
  missingMonths: number[]
}

export function alignToReferenceYear(daily: DailyHours, window: SourceWindow, referenceYear: number): AlignResult {
  const pools = new Map<string, string[]>()
  for (const [date, v] of daily) {
    if (date < window.start || date > window.end) continue
    if (v.some((x) => Number.isNaN(x))) continue
    const key = `${monthOf(date)}|${dayTypeOf(date)}`
    const list = pools.get(key) ?? []
    list.push(date)
    pools.set(key, list)
  }
  const series = new Float64Array(HOURS_PER_YEAR).fill(NaN)
  const mapping: AlignResult['mapping'] = []
  const missing = new Set<number>()
  let unmappedDays = 0
  referenceYearDates(referenceYear).forEach((target, di) => {
    const m = monthOf(target)
    const t = dayTypeOf(target)
    let pool = pools.get(`${m}|${t}`) ?? []
    if (pool.length === 0 && t === 'holiday') pool = pools.get(`${m}|sunday`) ?? []
    const dom = parseIsoDate(target).d
    let best: string | null = null
    let bestDist = Infinity
    for (const s of pool) {
      const dist = Math.abs(parseIsoDate(s).d - dom)
      if (dist < bestDist || (dist === bestDist && best !== null && s > best)) {
        best = s
        bestDist = dist
      }
    }
    mapping.push({ target, source: best })
    if (best === null) {
      unmappedDays++
      missing.add(m)
      return
    }
    series.set(daily.get(best) as Float64Array, di * 24)
  })
  return { series, mapping, unmappedDays, missingMonths: [...missing].sort((a, b) => a - b) }
}
