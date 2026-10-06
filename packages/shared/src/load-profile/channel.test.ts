import { describe, expect, it } from 'vitest'
import { QUALITY } from '../meter-data/types'
import { fromStoredChannel, toStoredChannel } from './channel'

describe('stored channel', () => {
  const r = (t: number, v: number | null, q = QUALITY.OK) => ({ tsEnd: t, value: v, quality: q as never })
  it('round-trips readings, keeping nulls and quality codes', () => {
    const rs = [r(1_800_000, 5), r(3_600_000, null, QUALITY.MISSING), r(5_400_000, 9, QUALITY.SPIKE)]
    const c = toStoredChannel(rs, 30)
    expect(c).toEqual({ firstTsEnd: 1_800_000, intervalMin: 30, values: [5, null, 9], quality: [0, 1, 4] })
    expect(fromStoredChannel(c)).toEqual(rs)
  })
  it('refuses a channel that is not contiguous', () => {
    expect(() => toStoredChannel([r(1_800_000, 1), r(5_400_000, 2)], 30)).toThrow(/60 min after the previous, expected 30/)
  })
})
