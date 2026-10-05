import { describe, expect, it } from 'vitest'
import type { TouCalendar } from '../tou'
import { annularSectorPath, clockSegments, energyRatesByPeriod } from './tou-visual'
import { ch, tariff } from './fixtures'

const h = (x: number) => x * 60
// Eskom 2026/27, high season weekday (schedule p56): peak 06-08 + 17-20, standard 08-17 + 20-22, off-peak 22-06.
const CAL: TouCalendar = {
  highSeasonMonths: [6, 7, 8], holidayTreatedAs: null, source: 'published',
  windows: [
    { season: 'high', dayType: 'weekday', startMinute: h(6), endMinute: h(8), period: 'peak' },
    { season: 'high', dayType: 'weekday', startMinute: h(8), endMinute: h(17), period: 'standard' },
    { season: 'high', dayType: 'weekday', startMinute: h(17), endMinute: h(20), period: 'peak' },
    { season: 'high', dayType: 'weekday', startMinute: h(20), endMinute: h(22), period: 'standard' },
  ],
}

describe('clockSegments', () => {
  it('merges the day into runs of one period, uncovered minutes off-peak', () => {
    expect(clockSegments(CAL, 'high', 'weekday')).toEqual([
      { startMinute: 0, endMinute: h(6), period: 'off_peak' },
      { startMinute: h(6), endMinute: h(8), period: 'peak' },
      { startMinute: h(8), endMinute: h(17), period: 'standard' },
      { startMinute: h(17), endMinute: h(20), period: 'peak' },
      { startMinute: h(20), endMinute: h(22), period: 'standard' },
      { startMinute: h(22), endMinute: h(24), period: 'off_peak' },
    ])
  })
  it('gives a single off-peak run for a day with no windows', () => {
    expect(clockSegments(CAL, 'low', 'sunday')).toEqual([{ startMinute: 0, endMinute: 1440, period: 'off_peak' }])
  })
})

describe('annularSectorPath', () => {
  it('starts at the top (midnight) and closes the shape', () => {
    const d = annularSectorPath(100, 100, 50, 90, 0, 360)
    expect(d.startsWith('M 100 10')).toBe(true)
    expect(d.trim().endsWith('Z')).toBe(true)
  })
  it('uses the large-arc flag only for sectors over half the day', () => {
    expect(annularSectorPath(0, 0, 1, 2, 0, 600)).toContain(' 0 0 1 ')
    expect(annularSectorPath(0, 0, 1, 2, 0, 900)).toContain(' 0 1 1 ')
  })
})

describe('energyRatesByPeriod', () => {
  it('returns c/kWh per season and period, R/kWh converted', () => {
    const t = tariff('Megaflex', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 600, season: 'high', tou: 'peak' }),
      ch({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 1.5, season: 'high', tou: 'standard' }),
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 90, season: 'low', tou: 'off_peak' }),
      ch({ component: 'ancillary', unit: 'c_per_kWh', amountExclVat: 0.4 }),
    ])
    const r = energyRatesByPeriod(t)
    expect(r.rates).toEqual([
      { season: 'high', period: 'peak', cPerKwh: 600 },
      { season: 'high', period: 'standard', cPerKwh: 150 },
      { season: 'low', period: 'off_peak', cPerKwh: 90 },
    ])
    expect(r.note).toBeNull()
  })
  it('expands an all-season charge to both seasons and takes the first block of a block tariff, saying so', () => {
    const t = tariff('TOU IBT', [
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, tou: 'peak', blockMinKwh: 0, blockMaxKwh: 500, blockBasis: 'monthly' }),
      ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 350, tou: 'peak', blockMinKwh: 500, blockMaxKwh: null, blockBasis: 'monthly' }),
    ], { structure: 'tou_ibt' })
    const r = energyRatesByPeriod(t)
    expect(r.rates).toEqual([
      { season: 'high', period: 'peak', cPerKwh: 300 },
      { season: 'low', period: 'peak', cPerKwh: 300 },
    ])
    expect(r.note).toBe('Showing the first block of each period; later blocks are in the charges table.')
  })
  it('has no rates for a tariff without TOU energy charges', () => {
    const t = tariff('Flat', [ch({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300 })], { structure: 'flat' })
    expect(energyRatesByPeriod(t).rates).toEqual([])
  })
})
