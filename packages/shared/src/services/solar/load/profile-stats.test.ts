import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR } from './calendar'
import { seriesCsvRows, siteProfileCharts } from './profile-stats'

const flat = (kw: number) => new Float64Array(HOURS_PER_YEAR).fill(kw)

describe('siteProfileCharts', () => {
  it('a flat 10 kW year: energy, peak, load factor, 50/50 day-night, flat LDC', () => {
    const c = siteProfileCharts(flat(10), 2025)
    expect(c.kpis.annualKwh).toBeCloseTo(87_600)
    expect(c.kpis.peakKw).toBe(10)
    expect(c.kpis.loadFactor).toBeCloseTo(1)
    expect(c.kpis.dayPct).toBeCloseTo(50)
    expect(c.kpis.dayKwh + c.kpis.nightKwh).toBeCloseTo(87_600)
    expect(c.monthlyKwh[0]).toBeCloseTo(31 * 24 * 10)
    expect(c.monthlyKwh[1]).toBeCloseTo(28 * 24 * 10)
    expect(c.annual).toHaveLength(365)
    expect(c.annual[0]).toEqual({ day: '2025-01-01', min: 10, mean: 10, max: 10 })
    expect(c.avgDayByMonth).toHaveLength(12)
    expect(c.avgDayByMonth[5]).toHaveLength(24)
    expect(c.avgDayByMonth[5][13]).toBeCloseTo(10)
    expect(c.ldc).toHaveLength(101)
    expect(c.ldc.every((p) => p.kw === 10)).toBe(true)
  })

  it('finds the peak hour and pools public holidays with Sundays', () => {
    const s = flat(1)
    s[24 * 40 + 14] = 50 // 2025-02-10 14:00 (a Monday)
    const c = siteProfileCharts(s, 2025)
    expect(c.kpis.peakKw).toBe(50)
    expect(c.kpis.peakAt).toBe('2025-02-10 14:00')
    expect(c.ldc[0]).toEqual({ pct: 0, kw: 50 })
    expect(c.dayTypeProfiles.weekday[14]).toBeGreaterThan(1)
    expect(c.dayTypeProfiles.sunday[14]).toBeCloseTo(1)
  })

  it('refuses a series that is not 8760 hours', () => {
    expect(() => siteProfileCharts(new Float64Array(10), 2025)).toThrow(RangeError)
  })
})

describe('seriesCsvRows', () => {
  it('writes one row per hour with a header, local date and hour start', () => {
    const rows = seriesCsvRows(flat(2.5), 2025)
    expect(rows[0]).toEqual(['date', 'hour_start', 'kW'])
    expect(rows).toHaveLength(HOURS_PER_YEAR + 1)
    expect(rows[1]).toEqual(['2025-01-01', '00:00', '2.500'])
    expect(rows[HOURS_PER_YEAR]).toEqual(['2025-12-31', '23:00', '2.500'])
  })
})
