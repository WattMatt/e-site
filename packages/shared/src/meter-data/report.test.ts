import { describe, it, expect } from 'vitest'
import { baseReport, channelReport, IMPLIED_DENSITY_BAND_W_PER_M2, issue, iso, METER_PARSER_VERSION } from './report'
import { QUALITY, type NormalisedChannel } from './types'

describe('report helpers', () => {
  it('baseReport fills every field', () => {
    const r = baseReport({ format: 'A' })
    expect(r).toMatchObject({ parserVersion: METER_PARSER_VERSION, format: 'A', rowOrder: null, errors: [], warnings: [], channels: [], impliedWPerM2: null })
    expect(r.formatLabel).toMatch(/^A:/)
    expect(JSON.parse(JSON.stringify(r))).toEqual(r)
  })
  it('band is 2–150 W/m²', () => {
    expect(IMPLIED_DENSITY_BAND_W_PER_M2).toEqual({ low: 2, high: 150 })
  })
  it('issue and iso', () => {
    expect(issue('spikes', 'x', 'p14')).toEqual({ code: 'spikes', message: 'x', column: 'p14' })
    expect(iso(Date.UTC(2025, 2, 9, 22, 30))).toBe('2025-03-09T22:30:00.000Z')
    expect(iso(null)).toBeNull()
  })
  it('channelReport converts times to ISO and keeps stats', () => {
    const ch: NormalisedChannel = {
      spec: { sourceColumn: 'p14', columnIndex: 1, quantity: 'active_power', direction: 'import', phase: null, sourceUnit: 'kW', unitFromTable: true },
      storedUnit: 'kW', intervalMin: 30, isCumulative: false, coverageOnly: false,
      readings: [{ tsEnd: 0, value: 1, quality: QUALITY.OK }],
      levelShifts: [{ startTsEnd: 0, endTsEnd: 1800000, count: 12, medianValue: 3 }],
      stats: { slots: 1, present: 1, usable: 1, estimated: 0, statusFlagged: 0, completeness: 1, firstTsEnd: 0, lastTsEnd: 0, spanDays: 0.02, longestGapHours: 0, zeroRunsOver6h: 0, spikes: 0, resetPairs: 0, tinyNegatives: 0, largeNegatives: 0, rollovers: 0, duplicateConflicts: 0, levelShiftIntervals: 12, meanUsable: 1, maxUsable: 1, sumUsable: 1 },
    }
    const r = channelReport(ch)
    expect(r).toMatchObject({ column: 'p14', quantity: 'active_power', storedUnit: 'kW', intervalMin: 30 })
    expect(r.stats.first).toBe('1970-01-01T00:00:00.000Z')
    expect(r.levelShifts[0]).toEqual({ start: '1970-01-01T00:00:00.000Z', end: '1970-01-01T00:30:00.000Z', count: 12, medianValue: 3 })
    expect('readings' in r).toBe(false)
  })
})
