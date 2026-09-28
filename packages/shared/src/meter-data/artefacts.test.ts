import { describe, it, expect } from 'vitest'
import { applyScaleCorrection, detectLevelShifts, flagSpikesAndNegatives, laggedDuplicateShare, medianOf, nearestRankPercentile } from './artefacts'
import { channelStats } from './stats'
import { QUALITY, type Reading } from './types'

const STEP = 30 * 60_000
const series = (values: Array<number | null>): Reading[] =>
  values.map((v, i) => ({ tsEnd: i * STEP, value: v, quality: v === null ? QUALITY.MISSING : QUALITY.OK }))

describe('percentiles', () => {
  it('median and nearest-rank', () => {
    expect(medianOf([3, 1, 2])).toBe(2)
    expect(medianOf([4, 1, 2, 3])).toBe(2.5)
    expect(medianOf([])).toBeNull()
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.95)).toBe(10)
    expect(nearestRankPercentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 0.5)).toBe(5)
  })
})

describe('detectLevelShifts (W recorded as kW)', () => {
  it('flags a run of ≥ 12 values ≥ 100 × the median, as quality 4', () => {
    const vals = [...Array(40).fill(300), ...Array(12).fill(300_000), ...Array(10).fill(300)]
    const { readings, segments } = detectLevelShifts(series(vals))
    expect(segments).toEqual([{ startTsEnd: 40 * STEP, endTsEnd: 51 * STEP, count: 12, medianValue: 300_000 }])
    expect(readings.filter((r) => r.quality === QUALITY.SPIKE)).toHaveLength(12)
  })
  it('an 11-long run is not a level shift', () => {
    const vals = [...Array(40).fill(300), ...Array(11).fill(300_000)]
    expect(detectLevelShifts(series(vals)).segments).toEqual([])
  })
  it('a gap breaks a run', () => {
    const vals = [...Array(40).fill(300), ...Array(6).fill(300_000), null, ...Array(6).fill(300_000)]
    expect(detectLevelShifts(series(vals)).segments).toEqual([])
  })
  it('applyScaleCorrection divides by 1000 and marks quality 7', () => {
    const vals = [...Array(40).fill(300), ...Array(12).fill(300_000)]
    const { readings, segments } = detectLevelShifts(series(vals))
    const fixed = applyScaleCorrection(readings, segments[0])
    expect(fixed[45]).toEqual({ tsEnd: 45 * STEP, value: 300, quality: QUALITY.SCALE_CORRECTED })
    expect(fixed[0]).toEqual(readings[0])
  })
})

describe('flagSpikesAndNegatives', () => {
  it('spikes above 50 × P95(|v|) are quality 4; negative spikes count as reset pairs', () => {
    const vals = [...Array(100).fill(10), 59000, -58795, 9.9]
    const { readings, counts } = flagSpikesAndNegatives(series(vals))
    expect(counts).toEqual({ spikes: 2, resetPairs: 1, tinyNegatives: 0, largeNegatives: 0 })
    expect(readings[100].quality).toBe(QUALITY.SPIKE)
    expect(readings[100].value).toBe(59000)              // raw value kept for display
  })
  it('tiny negatives (> −0.1) are clamped to 0 with quality 3; large ones keep their value', () => {
    const { readings, counts } = flagSpikesAndNegatives(series([10, -0.002, 10, -1710.82, 10]))
    expect(readings[1]).toMatchObject({ value: 0, quality: QUALITY.NEGATIVE })
    expect(readings[3]).toMatchObject({ value: -1710.82, quality: QUALITY.NEGATIVE })
    expect(counts).toMatchObject({ tinyNegatives: 1, largeNegatives: 1 })
  })
  it('an all-zero series has no spikes', () => {
    expect(flagSpikesAndNegatives(series([0, 0, 0])).counts.spikes).toBe(0)
  })
})

describe('laggedDuplicateShare', () => {
  it('detects b(t+1) == a(t) on non-zero pairs', () => {
    const a = series([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const b = series([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11])
    expect(laggedDuplicateShare(a, b)).toBe(1)
    expect(laggedDuplicateShare(b, a)).toBe(0)
  })
  it('needs at least 10 comparable pairs', () => {
    expect(laggedDuplicateShare(series([1, 2]), series([0, 1]))).toBeNull()
  })
})

describe('channelStats', () => {
  it('counts gaps, zero runs and usable values', () => {
    const vals: Array<number | null> = [1, null, null, 2, ...Array(12).fill(0), 3]
    const s = channelStats(series(vals), 30, { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0, rollovers: 0, duplicateConflicts: 0, levelShiftIntervals: 0 })
    expect(s).toMatchObject({ slots: 17, present: 15, usable: 15, longestGapHours: 1, zeroRunsOver6h: 1, sumUsable: 6, maxUsable: 3 })
    expect(s.completeness).toBeCloseTo(15 / 17, 10)
    expect(s.firstTsEnd).toBe(0)
    expect(s.lastTsEnd).toBe(16 * STEP)
    expect(s.spanDays).toBeCloseTo((16 * 30 + 30) / 1440, 10)
  })
})
