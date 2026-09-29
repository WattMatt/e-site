import { describe, it, expect } from 'vitest'
import { addDays, referenceYearDates } from './calendar'
import { alignToReferenceYear, latestWindow } from './align'
import type { DailyHours } from './hourly'

/** 2025, every hour = month × 100 + day, so the chosen source date can be read off the value. */
function year2025(except: (d: string) => boolean = () => false): DailyHours {
  const m: DailyHours = new Map()
  for (let d = '2025-01-01'; d <= '2025-12-31'; d = addDays(d, 1)) {
    if (except(d)) continue
    const [, mo, da] = d.split('-').map(Number)
    m.set(d, new Float64Array(24).fill(mo * 100 + da))
  }
  return m
}
const W = { start: '2025-01-01', end: '2025-12-31' }
const valueOn = (series: Float64Array, target: string) => series[referenceYearDates(2027).indexOf(target) * 24 + 12]

describe('alignToReferenceYear', () => {
  const r = alignToReferenceYear(year2025(), W, 2027)
  it.each([
    ['2027-01-01', 101],   // holiday → New Year 2025
    ['2027-01-02', 104],   // Saturday → nearest Saturday in January 2025 (4th)
    ['2027-01-04', 103],   // Monday → nearest weekday (Fri 3rd beats Mon 6th)
    ['2027-03-21', 321],   // Sunday + Human Rights Day → holiday 21 Mar 2025
    ['2027-03-22', 321],   // observed Monday → holiday 21 Mar 2025
    ['2027-12-27', 1226],  // observed Day of Goodwill → 26 Dec 2025 (nearest December holiday)
  ])('%s ← %i', (target, value) => {
    expect(valueOn(r.series, target)).toBe(value)
  })
  it('every day mapped', () => {
    expect(r).toMatchObject({ unmappedDays: 0, missingMonths: [] })
    expect(r.mapping.find((m) => m.target === '2027-01-04')?.source).toBe('2025-01-03')
  })
  it('a holiday with no holiday in that month of data falls back to the nearest Sunday', () => {
    const s = alignToReferenceYear(year2025((d) => d === '2025-03-21'), W, 2027).series
    expect(valueOn(s, '2027-03-22')).toBe(323)
  })
  it('a month with no data is reported and left NaN', () => {
    const s = alignToReferenceYear(year2025((d) => d.startsWith('2025-02')), W, 2027)
    expect(s.missingMonths).toEqual([2])
    expect(s.unmappedDays).toBe(28)
    expect(Number.isNaN(valueOn(s.series, '2027-02-10'))).toBe(true)
  })
})

describe('latestWindow', () => {
  it('the most recent 365 days ending at the last date', () => {
    expect(latestWindow(['2025-06-30', '2024-01-01'])).toEqual({ start: '2024-07-01', end: '2025-06-30' })
    expect(latestWindow([])).toBeNull()
  })
})
