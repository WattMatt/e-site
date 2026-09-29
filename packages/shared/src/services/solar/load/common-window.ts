/**
 * Site common window for S2 (engine spec §2.2): the most recent 12 months common to ≥ 80 % of
 * metered tenants. A meter "covers" a window when ≥ 335 of its 365 days have complete data; a
 * meter with < 30 days total is a shape sample only.
 */
import { addDays } from './calendar'
import type { SourceWindow } from './align'

export interface MeterCoverage {
  meterId: string
  /** Local dates with a complete day of usable data, any order. */
  coveredDates: string[]
}
export interface CommonWindowOptions {
  shareThreshold: number
  minDaysForMeter: number
  minCoveredDaysInWindow: number
  windowDays: number
}
export const DEFAULT_COMMON_WINDOW: CommonWindowOptions = { shareThreshold: 0.8, minDaysForMeter: 30, minCoveredDaysInWindow: 335, windowDays: 365 }

export interface CommonWindowResult {
  window: SourceWindow | null
  share: number
  meetsThreshold: boolean
  includedMeters: string[]
  droppedMeters: string[]
  shapeOnlyMeters: string[]
}

export function chooseCommonWindow(meters: MeterCoverage[], opts: CommonWindowOptions = DEFAULT_COMMON_WINDOW): CommonWindowResult {
  const shapeOnlyMeters = meters.filter((m) => m.coveredDates.length < opts.minDaysForMeter).map((m) => m.meterId)
  const eligible = meters.filter((m) => m.coveredDates.length >= opts.minDaysForMeter)
  if (eligible.length === 0) return { window: null, share: 0, meetsThreshold: false, includedMeters: [], droppedMeters: [], shapeOnlyMeters }
  const lastOf = (m: MeterCoverage) => [...m.coveredDates].sort()[m.coveredDates.length - 1]
  const ends = [...new Set(eligible.map(lastOf))].sort().reverse()
  const covers = (m: MeterCoverage, w: SourceWindow) => m.coveredDates.filter((d) => d >= w.start && d <= w.end).length >= opts.minCoveredDaysInWindow
  let best: { window: SourceWindow; share: number; included: string[] } | null = null
  for (const end of ends) {
    const window = { start: addDays(end, -(opts.windowDays - 1)), end }
    const included = eligible.filter((m) => covers(m, window)).map((m) => m.meterId)
    const share = included.length / eligible.length
    if (!best || share > best.share) best = { window, share, included }
    if (share >= opts.shareThreshold) break
  }
  const chosen = best as { window: SourceWindow; share: number; included: string[] }
  return {
    window: chosen.window,
    share: chosen.share,
    meetsThreshold: chosen.share >= opts.shareThreshold,
    includedMeters: chosen.included,
    droppedMeters: eligible.map((m) => m.meterId).filter((id) => !chosen.included.includes(id)),
    shapeOnlyMeters,
  }
}
