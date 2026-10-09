import { describe, it, expect } from 'vitest'
import { areaCheck, totalMeasuredM2, AREA_TOLERANCE } from './area-check'

describe('areaCheck', () => {
  it('uses a 2 % tolerance', () => {
    expect(AREA_TOLERANCE).toBe(0.02)
  })
  it('exactly 2 % either way still matches', () => {
    expect(areaCheck(255, 250).state).toBe('matches')
    expect(areaCheck(245, 250).state).toBe('matches')
  })
  it('just over 2 % either way differs', () => {
    expect(areaCheck(255.1, 250).state).toBe('differs')
    expect(areaCheck(244.9, 250).state).toBe('differs')
  })
  it('reports the signed difference in m² and percent', () => {
    expect(areaCheck(260, 250)).toEqual({ state: 'differs', measuredM2: 260, scheduledM2: 250, deltaM2: 10, deltaPct: 4 })
  })
  it('no scale: no measured area, nothing to compare', () => {
    expect(areaCheck(null, 250)).toEqual({ state: 'no_scale', measuredM2: null, scheduledM2: 250, deltaM2: null, deltaPct: null })
  })
  it('no scheduled area (null or zero): measured is shown, not compared', () => {
    expect(areaCheck(120, null)).toEqual({ state: 'no_schedule', measuredM2: 120, scheduledM2: null, deltaM2: null, deltaPct: null })
    expect(areaCheck(120, 0).state).toBe('no_schedule')
  })
})

describe('totalMeasuredM2', () => {
  it('sums measured areas and counts the unmeasured ones', () => {
    expect(totalMeasuredM2([10.5, null, 20.25, null])).toEqual({ totalM2: 30.75, unmeasured: 2 })
  })
  it('an empty plan totals zero', () => {
    expect(totalMeasuredM2([])).toEqual({ totalM2: 0, unmeasured: 0 })
  })
})
