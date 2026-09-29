import { describe, it, expect } from 'vitest'
import { addDays, daysBetween, fillDayTypeOf } from './calendar'
import { fillGaps } from './gap-fill'
import type { Timeline } from './hourly'

const START = '2025-03-03'   // Monday
const DAYS = daysBetween(START, '2025-04-20') + 1
const level = (date: string, h: number) => h + ({ weekday: 0, saturday: 100, sunday_holiday: 200 } as const)[fillDayTypeOf(date)]
const idx = (date: string, h: number) => daysBetween(START, date) * 24 + h

function timeline(): Timeline {
  const v = new Float64Array(DAYS * 24)
  for (let d = 0; d < DAYS; d++) for (let h = 0; h < 24; h++) v[d * 24 + h] = level(addDays(START, d), h)
  return { startDate: START, values: v }
}

describe('fillGaps', () => {
  const t = timeline()
  t.values[idx('2025-03-12', 10)] = NaN                                          // (a) 2 h: linear
  t.values[idx('2025-03-12', 11)] = NaN
  for (let h = 0; h < 24; h++) t.values[idx('2025-03-13', h)] = NaN              // (b) a weekday
  for (let h = 0; h < 24; h++) t.values[idx('2025-03-21', h)] = NaN              // (c) Human Rights Day (Friday)
  for (let d = 0; d < 15; d++) for (let h = 0; h < 24; h++) t.values[idx(addDays('2025-03-31', d), h)] = NaN  // (d) 15 days
  const r = fillGaps(t)

  it('≤ 2 h: linear', () => {
    expect(r.timeline.values[idx('2025-03-12', 10)]).toBeCloseTo(10, 10)
    expect(r.timeline.values[idx('2025-03-12', 11)]).toBeCloseTo(11, 10)
    expect(r.filled[idx('2025-03-12', 10)]).toBe(1)
  })
  it('≤ 14 days: same day-type, same hour, ± 4 weeks', () => {
    for (let h = 0; h < 24; h++) expect(r.timeline.values[idx('2025-03-13', h)]).toBeCloseTo(h, 10)
    for (let h = 0; h < 24; h++) expect(r.timeline.values[idx('2025-03-21', h)]).toBeCloseTo(200 + h, 10)  // a holiday fills from Sundays/holidays
    expect(r.filled[idx('2025-03-21', 0)]).toBe(2)
  })
  it('> 14 days: left missing', () => {
    expect(Number.isNaN(r.timeline.values[idx('2025-04-07', 12)])).toBe(true)
  })
  it('counts', () => {
    expect(r).toMatchObject({ shortFilled: 2, dayTypeFilled: 48, unfilledHours: 360 })
  })
})
