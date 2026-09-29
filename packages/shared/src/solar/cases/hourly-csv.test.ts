import { describe, it, expect } from 'vitest'
import { decodeHourlyCsv, encodeHourlyCsv, HOURLY_CSV_HEADER, sliceHourlyDays, type HourlySeries } from './hourly-csv'

const series = (): HourlySeries => {
  const mk = (k: number) => Float64Array.from({ length: 8760 }, (_, h) => (h % 24) * k)
  return { load: mk(1), pvAc: mk(2), selfUse: mk(0.5), import: mk(0.25), export: mk(0.1), curtail: mk(0), soc: mk(0), importPvOnly: mk(0.3), exportPvOnly: mk(0.2) }
}

describe('hourly CSV', () => {
  it('writes the documented header and the SAST hour start', () => {
    const text = encodeHourlyCsv(series())
    const lines = text.trimEnd().split('\n')
    expect(lines[0]).toBe(HOURLY_CSV_HEADER.join(','))
    expect(lines).toHaveLength(8761)
    expect(lines[1]!.startsWith('0,2025-01-01T00:00+02:00,')).toBe(true)
    expect(lines[8760]!.startsWith('8759,2025-12-31T23:00+02:00,')).toBe(true)
  })
  it('round-trips at 4 decimals', () => {
    const s = series()
    const back = decodeHourlyCsv(encodeHourlyCsv(s))
    expect(back.pvAc[23]).toBeCloseTo(46, 4)
    expect(back.importPvOnly[5]).toBeCloseTo(1.5, 4)
  })
  it('refuses a truncated or re-headed file', () => {
    expect(() => decodeHourlyCsv('a,b\n1,2')).toThrow('hourly CSV header does not match')
    const cut = encodeHourlyCsv(series()).split('\n').slice(0, 100).join('\n')
    expect(() => decodeHourlyCsv(cut)).toThrow('hourly CSV must have 8760 rows')
  })
  it('slices whole days for the zoom chart', () => {
    const rows = sliceHourlyDays(series(), 10, 11)
    expect(rows).toHaveLength(48)
    expect(rows[0]).toMatchObject({ hour: 240, startSast: '2025-01-11T00:00+02:00' })
  })
})
