import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { completeDays, fromTimeline, readingsToDailyHours, toTimeline } from './hourly'

const end = (date: [number, number, number], hh: number, mm: number) => Date.UTC(date[0], date[1] - 1, date[2], hh, mm) - 7_200_000

describe('readingsToDailyHours', () => {
  const day: [number, number, number] = [2025, 3, 10]
  const readings: Reading[] = []
  for (let h = 0; h < 24; h++) {
    readings.push({ tsEnd: end(day, h, 30), value: 10 * h, quality: QUALITY.OK })
    readings.push({ tsEnd: end(day, h + 1, 0), value: 10 * h + 2, quality: QUALITY.OK })
  }
  it('hour value = mean of its sub-intervals', () => {
    const d = readingsToDailyHours(readings, 30).get('2025-03-10') as Float64Array
    expect(d[0]).toBe(1)
    expect(d[23]).toBe(231)
  })
  it('an hour with a missing or unusable sub-interval is NaN', () => {
    const r = readings.filter((x) => x.tsEnd !== end(day, 5, 30)).map((x) => (x.tsEnd === end(day, 7, 30) ? { ...x, quality: QUALITY.SPIKE } : x))
    const d = readingsToDailyHours(r, 30).get('2025-03-10') as Float64Array
    expect(Number.isNaN(d[5])).toBe(true)
    expect(Number.isNaN(d[7])).toBe(true)
    expect(d[6]).toBe(61)
    expect(completeDays(readingsToDailyHours(r, 30))).toEqual([])
    expect(completeDays(readingsToDailyHours(readings, 30))).toEqual(['2025-03-10'])
  })
  it('refuses daily intervals', () => {
    expect(() => readingsToDailyHours(readings, 1440)).toThrow(/cannot build an hourly series/)
  })
})

describe('timelines', () => {
  it('contiguous from first to last date, NaN for days with no data, and back', () => {
    const m = new Map([['2025-03-10', new Float64Array(24).fill(1)], ['2025-03-12', new Float64Array(24).fill(3)]])
    const t = toTimeline(m)
    expect(t?.startDate).toBe('2025-03-10')
    expect(t?.values.length).toBe(72)
    expect(Number.isNaN(t!.values[24])).toBe(true)
    expect([...fromTimeline(t!).keys()]).toEqual(['2025-03-10', '2025-03-11', '2025-03-12'])
  })
})
