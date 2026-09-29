import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR, monthHourRanges } from '../../services/solar/time'
import { buildBaseline, diurnalProfile, monthlyGhiKwhM2, readBaseline } from './baseline'

// PV = 10 kW from 08:00 to 15:59 SAST every day, else 0.
const pvAc = Float64Array.from({ length: HOURS_PER_YEAR }, (_, h) => (h % 24 >= 8 && h % 24 < 16 ? 10 : 0))
const monthly = monthHourRanges().map(({ month, start, end }) => ({ month, pvKwh: ((end - start) / 24) * 80 }))

describe('baseline', () => {
  it('diurnal profile = mean kW per SAST hour of day, per month', () => {
    const d = diurnalProfile(pvAc)
    expect(d).toHaveLength(12)
    expect(d[0]).toHaveLength(24)
    expect(d[5]![7]).toBe(0)
    expect(d[5]![8]).toBe(10)
    expect(d[5]![15]).toBe(10)
    expect(d[5]![16]).toBe(0)
  })
  it('monthly GHI from TMY rows (W/m² hourly means → kWh/m²)', () => {
    const rows = [{ month: 1, ghi: 500 }, { month: 1, ghi: 500 }, { month: 2, ghi: 1000 }]
    const g = monthlyGhiKwhM2(rows)
    expect(g[0]).toBe(1)
    expect(g[1]).toBe(1)
    expect(g[2]).toBe(0)
  })
  it('builds and re-reads a baseline', () => {
    const b = buildBaseline({
      caseRunId: 'r1', inputsHash: 'h'.repeat(64), kpis: { dcKwp: 100, acKw: 80, performanceRatio: 0.81 },
      monthly: [...monthly].reverse(), pvAc, tmyRows: null,
    })
    expect(b.monthlyKwh[0]).toBe(31 * 80)
    expect(b.monthlyKwh[1]).toBe(28 * 80)
    expect(b.ghiKwhM2).toBeNull()
    expect(readBaseline(JSON.parse(JSON.stringify(b)))).toEqual(b)
  })
  it('refuses a run without twelve months', () => {
    expect(() => buildBaseline({ caseRunId: 'r1', inputsHash: 'h', kpis: { dcKwp: 1, acKw: 1, performanceRatio: 0.8 }, monthly: monthly.slice(0, 11), pvAc, tmyRows: null }))
      .toThrow('twelve monthly rows')
  })
})
