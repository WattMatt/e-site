import { describe, it, expect } from 'vitest'
import { dailyHeatmap, gapRanges, minMaxBuckets } from './downsample'
import type { Reading } from '../../../meter-data/types'

const S = 30 * 60_000

describe('minMaxBuckets', () => {
  it('passes small series through, one bucket per point', () => {
    expect(minMaxBuckets([0, S], [1, null], 10)).toEqual([
      { t0: 0, t1: 0, min: 1, max: 1, mean: 1 },
      { t0: S, t1: S, min: null, max: null, mean: null },
    ])
  })
  it('keeps the min and max of every bucket (spikes survive)', () => {
    const ts = Array.from({ length: 100 }, (_, i) => i * S)
    const v = ts.map((_, i) => (i === 57 ? 99 : 1))
    const b = minMaxBuckets(ts, v, 10)
    expect(b).toHaveLength(10)
    expect(Math.max(...b.map((x) => x.max ?? 0))).toBe(99)
    expect(b.every((x) => x.min === 1)).toBe(true)
  })
  it('refuses mismatched arrays', () => {
    expect(() => minMaxBuckets([0], [], 5)).toThrow(RangeError)
  })
})

describe('gapRanges', () => {
  it('reports time jumps and null runs, merged', () => {
    const ts = [1, 2, 3, 6, 7].map((k) => k * S)
    const v = [1, 1, 1, 1, null]
    expect(gapRanges(ts, v, 30)).toEqual([{ from: 3 * S, to: 5 * S }, { from: 6 * S, to: 7 * S }])
  })
})

describe('dailyHeatmap', () => {
  it('builds date × 24 cells with null for missing hours and missing days', () => {
    const t0 = Date.parse('2025-03-10T00:00:00+02:00')
    const r: Reading[] = []
    for (let i = 1; i <= 48; i++) r.push({ tsEnd: t0 + i * S, value: 4, quality: 0 })          // 2025-03-10 complete
    for (let i = 1; i <= 2; i++) r.push({ tsEnd: t0 + 2 * 86_400_000 + i * S, value: 8, quality: 0 }) // 2025-03-12 00:00 only
    const h = dailyHeatmap(r, 30)
    expect(h.dates).toEqual(['2025-03-10', '2025-03-11', '2025-03-12'])
    expect(h.cells[0].every((c) => c === 4)).toBe(true)
    expect(h.cells[1].every((c) => c === null)).toBe(true)
    expect(h.cells[2][0]).toBe(8)
    expect(h.cells[2][1]).toBeNull()
  })
})
