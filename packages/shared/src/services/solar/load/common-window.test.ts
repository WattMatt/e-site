import { describe, it, expect } from 'vitest'
import { addDays } from './calendar'
import { chooseCommonWindow } from './common-window'

const range = (a: string, b: string) => {
  const out: string[] = []
  for (let d = a; d <= b; d = addDays(d, 1)) out.push(d)
  return out
}
const meters = [
  { meterId: 'm1', coveredDates: range('2024-01-01', '2025-06-30') },
  { meterId: 'm2', coveredDates: range('2024-06-01', '2025-06-30') },
  { meterId: 'm3', coveredDates: range('2025-06-24', '2025-06-30') },   // 7 days: shape only
  { meterId: 'm4', coveredDates: range('2023-01-01', '2023-12-31') },   // old history
  { meterId: 'm5', coveredDates: range('2024-07-01', '2025-06-30') },
]

describe('chooseCommonWindow', () => {
  it('no window reaches 80 %: the best (latest on ties) is returned, flagged', () => {
    expect(chooseCommonWindow(meters)).toEqual({
      window: { start: '2024-07-01', end: '2025-06-30' }, share: 0.75, meetsThreshold: false,
      includedMeters: ['m1', 'm2', 'm5'], droppedMeters: ['m4'], shapeOnlyMeters: ['m3'],
    })
  })
  it('with a 70 % threshold the latest window qualifies', () => {
    expect(chooseCommonWindow(meters, { shareThreshold: 0.7, minDaysForMeter: 30, minCoveredDaysInWindow: 335, windowDays: 365 }).meetsThreshold).toBe(true)
  })
  it('no eligible meter', () => {
    expect(chooseCommonWindow([meters[2]])).toMatchObject({ window: null, shapeOnlyMeters: ['m3'] })
  })
})
