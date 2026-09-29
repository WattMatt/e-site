import { describe, expect, it } from 'vitest'
import { aggregateHourly, dayTypeOf, monthlyDemand, seasonForMonth, touPeriodAt, type TouCalendar, type TouWindow } from './tou'
import type { BillingSeason, TouPeriod } from './types'

const w = (season: BillingSeason, startMinute: number, endMinute: number, period: TouPeriod): TouWindow => ({
  season, dayType: 'weekday', startMinute, endMinute, period,
})
// Synthetic calendar (not Eskom's): weekday peak 06-08 and 17-20, standard 08-17 and 20-22; weekends off-peak.
const CAL: TouCalendar = {
  highSeasonMonths: [6, 7, 8],
  holidayTreatedAs: 'sunday',
  source: 'assumed_eskom',
  windows: (['high', 'low'] as const).flatMap((s) => [
    w(s, 360, 480, 'peak'), w(s, 480, 1020, 'standard'), w(s, 1020, 1200, 'peak'), w(s, 1200, 1320, 'standard'),
  ]),
}

describe('seasons, day types and windows', () => {
  it('maps months to seasons', () => {
    expect(seasonForMonth(7, CAL)).toBe('high')
    expect(seasonForMonth(1, CAL)).toBe('low')
  })
  it('knows weekdays, weekends and holidays', () => {
    expect(dayTypeOf(2025, 1, 1, undefined, CAL)).toBe('weekday')   // Wednesday
    expect(dayTypeOf(2025, 1, 4, undefined, CAL)).toBe('saturday')
    expect(dayTypeOf(2025, 1, 5, undefined, CAL)).toBe('sunday')
    expect(dayTypeOf(2025, 1, 1, new Set(['2025-01-01']), CAL)).toBe('sunday')
  })
  it('finds the period for a minute, defaulting to off-peak', () => {
    expect(touPeriodAt(CAL, 'low', 'weekday', 7 * 60)).toBe('peak')
    expect(touPeriodAt(CAL, 'low', 'weekday', 12 * 60)).toBe('standard')
    expect(touPeriodAt(CAL, 'low', 'weekday', 23 * 60)).toBe('off_peak')
    expect(touPeriodAt(CAL, 'low', 'saturday', 7 * 60)).toBe('off_peak')
  })
})

describe('monthlyDemand (peak-window maximum demand)', () => {
  it('finds overall and peak+standard-window maximum demand per month from hourly or 30-min kWh', () => {
    const hourly = new Float64Array(8760).fill(10)
    hourly[3 * 24 + 2] = 100 // Sat 4 Jan 02:00: off-peak spike
    hourly[5 * 24 + 7] = 60 //  Mon 6 Jan 07:00: weekday peak
    const [jan] = monthlyDemand({ kwh: hourly, intervalMinutes: 60, calendar: CAL, year: 2025 })
    expect(jan).toEqual({ month: 1, maxKw: 100, peakWindowMaxKw: 60 })
    const half = new Float64Array(17520).fill(5)
    half[2 * (5 * 24 + 7)] = 50 // Mon 6 Jan 07:00-07:30: 50 kWh in half an hour = 100 kW
    expect(monthlyDemand({ kwh: half, intervalMinutes: 30, calendar: CAL, year: 2025 })[0]).toEqual({ month: 1, maxKw: 100, peakWindowMaxKw: 100 })
    expect(() => monthlyDemand({ kwh: new Float64Array(10), intervalMinutes: 30, calendar: CAL, year: 2025 })).toThrow(RangeError)
  })
})

describe('aggregateHourly', () => {
  const ones = new Float64Array(8760).fill(1)
  it('splits January 2025 (23 weekdays) into TOU kWh', () => {
    const jan = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2025 })[0]
    expect(jan).toMatchObject({ month: 1, days: 31, season: 'low' })
    expect(jan.importKwh).toEqual({ peak: 23 * 5, standard: 23 * 11, off_peak: 744 - 23 * 16 })
  })
  it('moves a holiday to its treated-as day type', () => {
    const jan = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2025, holidays: new Set(['2025-01-01']) })[0]
    expect(jan.importKwh).toEqual({ peak: 22 * 5, standard: 22 * 11, off_peak: 744 - 22 * 16 })
  })
  it('drops 29 February in a leap year and keeps 8760 hours', () => {
    const months = aggregateHourly({ importKwh: ones, calendar: CAL, year: 2024 })
    expect(months[1].days).toBe(28)
    const total = months.reduce((a, m) => a + m.importKwh.peak + m.importKwh.standard + m.importKwh.off_peak, 0)
    expect(total).toBe(8760)
  })
  it('aggregates export alongside import and refuses a wrong-length series', () => {
    const months = aggregateHourly({ importKwh: ones, exportKwh: ones, calendar: CAL, year: 2025 })
    expect(months[0].exportKwh).toEqual(months[0].importKwh)
    expect(() => aggregateHourly({ importKwh: new Float64Array(10), calendar: CAL, year: 2025 })).toThrow(RangeError)
  })
})
