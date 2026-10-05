import { describe, expect, it } from 'vitest'
import { QUALITY } from '../meter-data/types'
import { importQuality } from './quality'

describe('importQuality', () => {
  // 30-min slots from 2025-01-01 00:30 SAST (= 2024-12-31 22:30 UTC).
  const t0 = Date.UTC(2024, 11, 31, 22, 30)
  const values = [10, null, null, 12, 999, -50, 11, null, 9, 8]
  const quality = [0, 1, 1, 0, QUALITY.SPIKE, QUALITY.NEGATIVE, QUALITY.DUPLICATE, 1, 0, QUALITY.STATUS]
  const q = importQuality({ firstTsEnd: t0, intervalMin: 30, values, quality }, { duplicates: 3, unparseableRows: 1, irregularSteps: 0 })

  it('counts usable slots and coverage with the parser usability rule', () => {
    // usable: 10, 12, 9 (spike, large negative, conflicting duplicate, missing, status are not usable)
    expect(q.slots).toBe(10)
    expect(q.usable).toBe(3)
    expect(q.coveragePct).toBeCloseTo(30, 9)
  })
  it('reports gap runs, longest first, as local interval start → end', () => {
    expect(q.gapRuns).toBe(3) // [1,2] [4..7] [9]
    expect(q.longestGapMin).toBe(120)
    expect(q.gaps[0]).toEqual({ from: '2025-01-01 02:00', to: '2025-01-01 04:00', minutes: 120 })
    expect(q.gaps[1]).toEqual({ from: '2025-01-01 00:30', to: '2025-01-01 01:30', minutes: 60 })
  })
  it('counts the parser flags and passes file-level counts through', () => {
    expect([q.spikes, q.negatives, q.conflictingDuplicates, q.statusFlagged]).toEqual([1, 1, 1, 1])
    expect([q.exactDuplicates, q.unparseableRows, q.irregularSteps]).toEqual([3, 1, 0])
    expect(q.first).toBe('2025-01-01 00:30')
    expect(q.last).toBe('2025-01-01 05:00')
  })
})
