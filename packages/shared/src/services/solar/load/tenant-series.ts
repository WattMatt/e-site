/**
 * One meter → one reference-year series (engine spec §2.2): hourly, gap-filled, aligned by
 * day-type; months the meter does not cover are filled by the tenant's synthesis scaled to the
 * meter's observed level, never by zero.
 */
import type { Reading } from '../../../meter-data/types'
import { alignToReferenceYear, latestWindow, type SourceWindow } from './align'
import { fillGaps } from './gap-fill'
import { completeDays, fromTimeline, readingsToDailyHours, toTimeline } from './hourly'

export function fillWithScaledSynthesis(aligned: Float64Array, synth: Float64Array): { series: Float64Array; filledHours: number; scale: number } {
  let obs = 0
  let syn = 0
  for (let i = 0; i < aligned.length; i++) {
    if (Number.isNaN(aligned[i])) continue
    obs += aligned[i]
    syn += synth[i]
  }
  const scale = syn > 0 ? obs / syn : 1
  const series = Float64Array.from(aligned)
  let filledHours = 0
  for (let i = 0; i < series.length; i++) {
    if (!Number.isNaN(series[i])) continue
    series[i] = synth[i] * scale
    filledHours++
  }
  return { series, filledHours, scale }
}

export interface MeterSeriesResult {
  series: Float64Array
  window: SourceWindow | null
  gapFill: { shortFilled: number; dayTypeFilled: number; unfilledHours: number }
  unmappedDays: number
  missingMonths: number[]
  filledFromSynthesis: number
  synthesisScale: number
}

export function meterReferenceSeries(input: {
  readings: Reading[]
  intervalMin: number
  referenceYear: number
  window?: SourceWindow | null
  fallbackSynth: Float64Array
}): MeterSeriesResult {
  const empty = { shortFilled: 0, dayTypeFilled: 0, unfilledHours: 0 }
  const tl = toTimeline(readingsToDailyHours(input.readings, input.intervalMin))
  if (!tl) {
    const f = fillWithScaledSynthesis(new Float64Array(input.fallbackSynth.length).fill(NaN), input.fallbackSynth)
    return { series: f.series, window: null, gapFill: empty, unmappedDays: 365, missingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
  }
  const gf = fillGaps(tl)
  const daily = fromTimeline(gf.timeline)
  const window = input.window ?? latestWindow(completeDays(daily))
  const gapFill = { shortFilled: gf.shortFilled, dayTypeFilled: gf.dayTypeFilled, unfilledHours: gf.unfilledHours }
  if (!window) {
    const f = fillWithScaledSynthesis(new Float64Array(input.fallbackSynth.length).fill(NaN), input.fallbackSynth)
    return { series: f.series, window: null, gapFill, unmappedDays: 365, missingMonths: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12], filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
  }
  const al = alignToReferenceYear(daily, window, input.referenceYear)
  const f = fillWithScaledSynthesis(al.series, input.fallbackSynth)
  return { series: f.series, window, gapFill, unmappedDays: al.unmappedDays, missingMonths: al.missingMonths, filledFromSynthesis: f.filledHours, synthesisScale: f.scale }
}
