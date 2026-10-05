import { describe, expect, it } from 'vitest'
import { QUALITY } from '../meter-data/types'
import { analyseProfile, coincidentSum, suggestNmd } from './analyse'
import { measuredReferenceSeries } from './measured'
import { HAND, handCheckedReadings } from './__fixtures__/hand-checked'

describe('analyseProfile — hand-checked year (2025, 30-min)', () => {
  const readings = handCheckedReadings()
  const measured = measuredReferenceSeries(readings, 30, 2025)
  const a = analyseProfile({
    series: measured.series,
    referenceYear: 2025,
    powerFactor: 0.95,
    measured: [{ kw: readings, kva: null, intervalMin: 30 }],
    syntheticPeakKw: 0,
  })

  it('reference series keeps every kWh of a complete matching year', () => {
    expect(measured.ownShapeFilledHours).toBe(0)
    expect(a.kpis.annualKwh).toBeCloseTo(HAND.annualKwh, 6)
    expect(a.monthlyKwh[0]).toBeCloseTo(HAND.januaryKwh, 6)
  })
  it('hourly peak and load factor', () => {
    expect(a.kpis.peakKw).toBeCloseTo(HAND.peakKwHourly, 9)
    expect(a.kpis.peakAt).toBe(HAND.peakAt)
    expect(a.kpis.loadFactor).toBeCloseTo(HAND.loadFactor, 9)
  })
  it('interval MD per month from the native readings, with the timestamp', () => {
    expect(a.md?.peak.kw).toBe(HAND.mdKwMarch)
    expect(a.md?.peak.kva).toBeCloseTo(HAND.mdKvaMarch, 9)
    expect(a.md?.peak.at).toBe('2025-03-12 10:30') // interval END, local
    const months = a.md?.months ?? []
    expect(months).toHaveLength(12)
    expect(months.find((m) => m.month === '2025-01')?.kva).toBeCloseTo(HAND.mdKvaOther, 9)
  })
  it('NMD suggestion: highest monthly MD × 1.10, up to the next 5 kVA', () => {
    expect(a.nmd.kva).toBe(HAND.nmdKva)
    expect(a.nmd.basis).toBe('measured_md')
  })
  it('heat map is 365 × 24 of the reference series; overlays have 24 points', () => {
    expect(a.heatmap.cells).toHaveLength(365)
    expect(a.heatmap.cells[70][10]).toBeCloseTo(125, 9) // 2025-03-12 is day index 70
    expect(a.seasonal.high).toHaveLength(24)
    expect(a.seasonal.high[12]).toBeCloseTo(100, 9) // weekday noon, Jun–Aug
    expect(a.seasonal.low[3]).toBeCloseTo(20, 9)
    expect(a.ldc[0].kw).toBeCloseTo(125, 9)
  })
})

describe('suggestNmd', () => {
  it('synthetic-only profile: hourly design peak ÷ PF', () => {
    expect(suggestNmd({ measuredMdKva: null, syntheticPeakKw: 0, profilePeakKw: 90, powerFactor: 0.9 })).toEqual({ kva: 110, basis: 'design_peak', basisKva: 100 })
  })
  it('measured + synthetic: measured MD plus the synthetic peak, non-coincident (conservative)', () => {
    expect(suggestNmd({ measuredMdKva: 100, syntheticPeakKw: 45, profilePeakKw: 140, powerFactor: 0.9 })).toEqual({ kva: 165, basis: 'measured_md_plus_synthetic', basisKva: 150 })
  })
})

describe('measuredReferenceSeries — gaps', () => {
  it('hours the meter never covered are filled from its own day-type average and counted', () => {
    // January only, 60-min: weekdays 10 kW, weekends 4 kW.
    const rs = []
    for (let d = 1; d <= 31; d++) {
      const dow = new Date(Date.UTC(2025, 0, d)).getUTCDay()
      for (let h = 0; h < 24; h++) rs.push({ tsEnd: Date.UTC(2025, 0, d, h) - 7_200_000 + 3_600_000, value: dow === 0 || dow === 6 ? 4 : 10, quality: QUALITY.OK as never })
    }
    const m = measuredReferenceSeries(rs, 60, 2025)
    expect(m.ownShapeFilledHours).toBe(8760 - 31 * 24)
    expect(m.missingMonths).toEqual([2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(Number.isNaN(m.series[5000])).toBe(false)
    expect(m.series[31 * 24 + 12]).toBe(4) // 2025-02-01 is a Saturday
  })
  it('refuses a meter with no complete day', () => {
    expect(() => measuredReferenceSeries([{ tsEnd: 3_600_000, value: 1, quality: 0 as never }], 60, 2025)).toThrow(/no complete day/)
  })
})

describe('several meters', () => {
  /** Constant kW on 30-min slots for [fromDay, toDay) of 2025 (day index from 1 Jan). */
  const constant = (kw: number, fromDay: number, toDay: number, intervalMin = 30) => {
    const out = []
    const start = Date.UTC(2025, 0, 1) - 7_200_000
    for (let t = start + fromDay * 86_400_000 + intervalMin * 60_000; t <= start + toDay * 86_400_000; t += intervalMin * 60_000) out.push({ tsEnd: t, value: kw, quality: QUALITY.OK as never })
    return out
  }

  it('coincidentSum re-buckets to the coarsest interval and sums only where every meter has a value', () => {
    const a = constant(10, 0, 2, 15)
    const b = constant(5, 1, 3, 30)
    const s = coincidentSum([{ readings: a, intervalMin: 15 }, { readings: b, intervalMin: 30 }])!
    expect(s.intervalMin).toBe(30)
    expect(s.readings).toHaveLength(48) // the one overlapping day
    expect(s.readings.every((r) => r.value === 15)).toBe(true)
  })

  it('overlapping meters: MD is the coincident sum', () => {
    const a = constant(10, 0, 60)
    const b = constant(20, 0, 60)
    const md = analyseProfile({ series: new Float64Array(8760).fill(30), referenceYear: 2025, powerFactor: 0.95, measured: [{ kw: a, kva: null, intervalMin: 30 }, { kw: b, kva: null, intervalMin: 30 }], syntheticPeakKw: 0 }).md!
    expect(md.basis).toBe('coincident')
    expect(md.peak.kva).toBeCloseTo(30 / 0.95, 9)
  })

  it('meters that do not overlap (< 30 coincident days): MD is the sum of each meter\'s own peak, never dropped', () => {
    const a = constant(10, 0, 40) // Jan–Feb
    const b = constant(20, 180, 220) // Jul–Aug
    const r = analyseProfile({ series: new Float64Array(8760).fill(30), referenceYear: 2025, powerFactor: 0.95, measured: [{ kw: a, kva: null, intervalMin: 30 }, { kw: b, kva: null, intervalMin: 30 }], syntheticPeakKw: 0 })
    expect(r.md).not.toBeNull()
    expect(r.md!.basis).toBe('sum_of_meter_peaks')
    expect(r.md!.peak.kva).toBeCloseTo(30 / 0.95, 9)
    expect(r.md!.months).toEqual([]) // no month-by-month coincident data
    expect(r.nmd.basis).toBe('measured_md')
  })
})
