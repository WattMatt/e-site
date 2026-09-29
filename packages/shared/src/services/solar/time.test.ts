import { describe, expect, it } from 'vitest'
import {
  HOURS_PER_YEAR,
  assert8760,
  dayOfYear0,
  monthHourRanges,
  monthOfHour,
  monthlySums,
  sastHourStartUtcMs,
} from './time'

describe('time base', () => {
  it('has 8760 hours split into the non-leap months', () => {
    const r = monthHourRanges()
    expect(r).toHaveLength(12)
    expect(r[0]).toEqual({ month: 1, start: 0, end: 744 })
    expect(r[1]).toEqual({ month: 2, start: 744, end: 1416 })
    expect(r[11]!.end).toBe(HOURS_PER_YEAR)
  })

  it('maps hour indices to months at the boundaries', () => {
    expect(monthOfHour(0)).toBe(1)
    expect(monthOfHour(743)).toBe(1)
    expect(monthOfHour(744)).toBe(2)
    expect(monthOfHour(1415)).toBe(2)
    expect(monthOfHour(1416)).toBe(3)
    expect(monthOfHour(8759)).toBe(12)
  })

  it('refuses 29 February and out-of-range dates', () => {
    expect(dayOfYear0(1, 1)).toBe(0)
    expect(dayOfYear0(3, 1)).toBe(59)
    expect(dayOfYear0(12, 31)).toBe(364)
    expect(() => dayOfYear0(2, 29)).toThrow(/day out of range/)
    expect(() => dayOfYear0(13, 1)).toThrow(/month out of range/)
  })

  it('hour 0 starts at 01 Jan 00:00 SAST = 31 Dec 22:00 UTC', () => {
    expect(sastHourStartUtcMs(0)).toBe(Date.UTC(2024, 11, 31, 22))
    expect(sastHourStartUtcMs(2)).toBe(Date.UTC(2025, 0, 1, 0))
  })

  it('sums an 8760 series by month and refuses any other length', () => {
    const ones = new Float64Array(HOURS_PER_YEAR).fill(1)
    expect(monthlySums(ones)).toEqual([744, 672, 744, 720, 744, 720, 744, 744, 720, 744, 720, 744])
    expect(() => assert8760(new Float64Array(8784), 'load')).toThrow(/load must have 8760/)
  })
})
