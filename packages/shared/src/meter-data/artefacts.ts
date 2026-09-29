/**
 * Artefact detection (engine spec §2.1 step 5, as-is/10 §6.1 step 9). Order matters and is fixed:
 * level shifts first (so a W-scale segment does not set the spike threshold), then spikes, then
 * negatives among what is left. Raw values are kept for display; quality decides usability.
 */
import { QUALITY, type LevelShiftSegment, type Reading } from './types'

export function medianOf(xs: number[]): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  const mid = Math.floor(s.length / 2)
  return s.length % 2 === 1 ? s[mid] : (s[mid - 1] + s[mid]) / 2
}

export function nearestRankPercentile(xs: number[], p: number): number | null {
  if (xs.length === 0) return null
  const s = [...xs].sort((a, b) => a - b)
  return s[Math.max(0, Math.ceil(p * s.length) - 1)]
}

const clean = (r: Reading) => r.value !== null && (r.quality === QUALITY.OK || r.quality === QUALITY.ESTIMATED)

export function detectLevelShifts(
  readings: Reading[],
  opts: { factor: number; minRun: number } = { factor: 100, minRun: 12 },
): { readings: Reading[]; segments: LevelShiftSegment[] } {
  const med = medianOf(readings.filter((r) => clean(r) && (r.value as number) > 0).map((r) => r.value as number))
  if (med === null) return { readings, segments: [] }
  const out = [...readings]
  const segments: LevelShiftSegment[] = []
  let start = -1
  const close = (end: number) => {
    const len = end - start
    if (start >= 0 && len >= opts.minRun) {
      const vals = out.slice(start, end).map((r) => r.value as number)
      segments.push({ startTsEnd: out[start].tsEnd, endTsEnd: out[end - 1].tsEnd, count: len, medianValue: medianOf(vals) as number })
      for (let k = start; k < end; k++) out[k] = { ...out[k], quality: QUALITY.SPIKE }
    }
    start = -1
  }
  for (let i = 0; i < out.length; i++) {
    const hit = clean(out[i]) && (out[i].value as number) >= opts.factor * med
    if (hit && start < 0) start = i
    if (!hit && start >= 0) close(i)
  }
  if (start >= 0) close(out.length)
  return { readings: out, segments }
}

export function flagSpikesAndNegatives(
  readings: Reading[],
  opts: { spikeFactor: number; percentile: number; tinyNegativeFloor: number } = { spikeFactor: 50, percentile: 0.95, tinyNegativeFloor: -0.1 },
): { readings: Reading[]; counts: { spikes: number; resetPairs: number; tinyNegatives: number; largeNegatives: number } } {
  const p = nearestRankPercentile(readings.filter(clean).map((r) => Math.abs(r.value as number)), opts.percentile)
  const threshold = p !== null && p > 0 ? opts.spikeFactor * p : null
  const counts = { spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0 }
  const out = readings.map((r): Reading => {
    if (!clean(r)) return r
    const v = r.value as number
    if (threshold !== null && Math.abs(v) > threshold) {
      counts.spikes++
      if (v < 0) counts.resetPairs++
      return { ...r, quality: QUALITY.SPIKE }
    }
    if (v < 0) {
      if (v > opts.tinyNegativeFloor) {
        counts.tinyNegatives++
        return { ...r, value: 0, quality: QUALITY.NEGATIVE }
      }
      counts.largeNegatives++
      return { ...r, quality: QUALITY.NEGATIVE }
    }
    return r
  })
  return { readings: out, counts }
}

/** User-confirmed correction of a W-scale segment (quality 7). */
export function applyScaleCorrection(readings: Reading[], segment: LevelShiftSegment, divisor = 1000): Reading[] {
  return readings.map((r) =>
    r.tsEnd >= segment.startTsEnd && r.tsEnd <= segment.endTsEnd && r.quality === QUALITY.SPIKE && r.value !== null
      ? { ...r, value: r.value / divisor, quality: QUALITY.SCALE_CORRECTED }
      : r,
  )
}

/**
 * Share of consecutive slots where b[i+1] equals a[i], over pairs where both are present and
 * non-zero. 1.0 means b is a copy of a delayed by one interval (a site PV meter, "Solar Total Power").
 */
export function laggedDuplicateShare(a: Reading[], b: Reading[]): number | null {
  let considered = 0
  let equal = 0
  for (let i = 0; i + 1 < a.length && i + 1 < b.length; i++) {
    const x = a[i].value
    const y = b[i + 1].value
    if (x === null || y === null || x === 0 || y === 0) continue
    considered++
    if (Math.abs(x - y) < 1e-9) equal++
  }
  return considered >= 10 ? equal / considered : null
}
