import { isUsable, QUALITY, type ChannelStats, type Reading } from './types'

export interface ChannelCounters {
  spikes: number
  resetPairs: number
  tinyNegatives: number
  largeNegatives: number
  rollovers: number
  duplicateConflicts: number
  levelShiftIntervals: number
}

export function channelStats(readings: Reading[], intervalMin: number, counters: ChannelCounters): ChannelStats {
  let present = 0
  let usable = 0
  let estimated = 0
  let statusFlagged = 0
  let sum = 0
  let max: number | null = null
  let gap = 0
  let longestGap = 0
  let zeroRun = 0
  let zeroRuns = 0
  let firstTsEnd: number | null = null
  let lastTsEnd: number | null = null
  const zeroRunSlots = Math.ceil(360 / intervalMin)
  for (const r of readings) {
    if (r.value === null) {
      gap++
      longestGap = Math.max(longestGap, gap)
    } else {
      gap = 0
      present++
      if (firstTsEnd === null) firstTsEnd = r.tsEnd
      lastTsEnd = r.tsEnd
    }
    if (r.quality === QUALITY.ESTIMATED) estimated++
    if (r.quality === QUALITY.STATUS) statusFlagged++
    if (isUsable(r)) {
      const v = r.value as number
      usable++
      sum += v
      max = max === null ? v : Math.max(max, v)
    }
    if (r.value === 0) {
      zeroRun++
      if (zeroRun === zeroRunSlots) zeroRuns++
    } else zeroRun = 0
  }
  const slots = readings.length
  return {
    slots, present, usable, estimated, statusFlagged,
    completeness: slots > 0 ? present / slots : 0,
    firstTsEnd, lastTsEnd,
    spanDays: firstTsEnd === null || lastTsEnd === null ? 0 : (lastTsEnd - firstTsEnd) / 86_400_000 + intervalMin / 1440,
    longestGapHours: (longestGap * intervalMin) / 60,
    zeroRunsOver6h: zeroRuns,
    ...counters,
    meanUsable: usable > 0 ? sum / usable : null,
    maxUsable: max,
    sumUsable: sum,
  }
}
