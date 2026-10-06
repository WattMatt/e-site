/**
 * A parsed meter channel as the load-profile tool stores it: one contiguous run of
 * fixed-interval slots (first interval END + interval + parallel value/quality arrays).
 * The meter-data parser already inserts a MISSING slot for every absent interval, so a
 * normalised channel IS contiguous; storing it as arrays keeps one row per channel.
 */
import { QUALITY, type QualityCode, type Reading } from '../meter-data/types'

export interface StoredChannel {
  /** Epoch ms (UTC) of the end of the first interval. */
  firstTsEnd: number
  intervalMin: number
  values: ReadonlyArray<number | null>
  quality: ReadonlyArray<number>
}

export const LOAD_PROFILE_INTERVALS = [5, 10, 15, 30, 60] as const

/** Readings → stored arrays. Throws on a step that is not exactly one interval. */
export function toStoredChannel(readings: readonly Reading[], intervalMin: number): StoredChannel {
  if (readings.length === 0) throw new RangeError('toStoredChannel: no readings')
  const step = intervalMin * 60_000
  const sorted = [...readings].sort((a, b) => a.tsEnd - b.tsEnd)
  for (let i = 1; i < sorted.length; i++) {
    if (sorted[i].tsEnd - sorted[i - 1].tsEnd !== step) {
      throw new RangeError(`toStoredChannel: slot ${i} is ${(sorted[i].tsEnd - sorted[i - 1].tsEnd) / 60_000} min after the previous, expected ${intervalMin}`)
    }
  }
  return {
    firstTsEnd: sorted[0].tsEnd,
    intervalMin,
    values: sorted.map((r) => r.value),
    quality: sorted.map((r) => r.quality),
  }
}

export function fromStoredChannel(c: StoredChannel): Reading[] {
  if (c.values.length !== c.quality.length) throw new RangeError('fromStoredChannel: values and quality differ in length')
  const step = c.intervalMin * 60_000
  return c.values.map((value, i) => ({
    tsEnd: c.firstTsEnd + i * step,
    value,
    quality: (c.quality[i] ?? QUALITY.OK) as QualityCode,
  }))
}
