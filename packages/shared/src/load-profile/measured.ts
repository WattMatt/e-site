/**
 * One measured channel → the 8760-hour reference year. Reuses the Solar engine's own steps
 * (readingsToDailyHours → fillGaps → alignToReferenceYear) unchanged. What differs from Solar's
 * meterReferenceSeries is the last step: Solar fills uncovered months from a TENANT synthesis;
 * this tool has no tenant behind a meter, so uncovered hours are filled from the meter's OWN
 * average day per day type and the count is reported — never silently, never with zero.
 */
import type { Reading } from '../meter-data/types'
import { alignToReferenceYear, latestWindow, type SourceWindow } from '../services/solar/load/align'
import { dayTypeOf, HOURS_PER_YEAR, referenceYearDates, type DayType } from '../services/solar/load/calendar'
import { fillGaps } from '../services/solar/load/gap-fill'
import { completeDays, fromTimeline, readingsToDailyHours, toTimeline } from '../services/solar/load/hourly'

export interface MeasuredSeries {
  series: Float64Array
  window: SourceWindow
  /** Hours filled inside the data by Solar's gap-fill (short interpolation / same-day-type). */
  gapShortFilled: number
  gapDayTypeFilled: number
  /** Reference-year hours with no source day at all, filled from the meter's own day-type average. */
  ownShapeFilledHours: number
  missingMonths: number[]
}

export class MeasuredSeriesError extends Error {}

const TYPES: DayType[] = ['weekday', 'saturday', 'sunday', 'holiday']

export function measuredReferenceSeries(readings: Reading[], intervalMin: number, referenceYear: number): MeasuredSeries {
  if (intervalMin > 60 || 60 % intervalMin !== 0) throw new MeasuredSeriesError(`A ${intervalMin}-minute channel cannot build an hourly profile`)
  const tl = toTimeline(readingsToDailyHours(readings, intervalMin))
  if (!tl) throw new MeasuredSeriesError('The channel has no complete day of usable readings')
  const gf = fillGaps(tl)
  const daily = fromTimeline(gf.timeline)
  const window = latestWindow(completeDays(daily))
  if (!window) throw new MeasuredSeriesError('The channel has no complete day of usable readings')
  const al = alignToReferenceYear(daily, window, referenceYear)

  const dates = referenceYearDates(referenceYear)
  const sum: Record<DayType, Float64Array> = Object.fromEntries(TYPES.map((t) => [t, new Float64Array(24)])) as never
  const n: Record<DayType, Uint32Array> = Object.fromEntries(TYPES.map((t) => [t, new Uint32Array(24)])) as never
  const all = { s: new Float64Array(24), n: new Uint32Array(24) }
  dates.forEach((d, di) => {
    const t = dayTypeOf(d)
    for (let h = 0; h < 24; h++) {
      const v = al.series[di * 24 + h]
      if (Number.isNaN(v)) continue
      sum[t][h] += v
      n[t][h]++
      all.s[h] += v
      all.n[h]++
    }
  })
  const series = Float64Array.from(al.series)
  let ownShapeFilledHours = 0
  dates.forEach((d, di) => {
    const t = dayTypeOf(d)
    // A day type the meter never saw (e.g. no holiday in the window) borrows Sunday, then the all-days mean.
    const src: DayType = n[t][0] > 0 ? t : t === 'holiday' && n.sunday[0] > 0 ? 'sunday' : t
    for (let h = 0; h < 24; h++) {
      const i = di * 24 + h
      if (!Number.isNaN(series[i])) continue
      series[i] = n[src][h] > 0 ? sum[src][h] / n[src][h] : all.n[h] > 0 ? all.s[h] / all.n[h] : 0
      ownShapeFilledHours++
    }
  })
  if (series.length !== HOURS_PER_YEAR) throw new Error('measuredReferenceSeries: length invariant')
  return { series, window, gapShortFilled: gf.shortFilled, gapDayTypeFilled: gf.dayTypeFilled, ownShapeFilledHours, missingMonths: al.missingMonths }
}
