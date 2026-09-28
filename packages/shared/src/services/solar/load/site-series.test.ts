import { describe, it, expect } from 'vitest'
import { HOURS_PER_YEAR } from './calendar'
import { buildS1, buildS2, buildS3, buildS4, LoadModelError, monthlyEnergyKwh, reconcileMonthly } from './site-series'

const k = (v: number) => new Float64Array(HOURS_PER_YEAR).fill(v)

describe('S1 (bulk)', () => {
  it('refuses a meter not confirmed as the point of supply', () => {
    expect(() => buildS1({ bulk: k(100), supplyPointConfirmed: false })).toThrow(LoadModelError)
    try { buildS1({ bulk: k(100), supplyPointConfirmed: false }) } catch (e) { expect((e as LoadModelError).code).toBe('supply_point_not_confirmed') }
  })
  it('adds existing PV generation when the bulk meter sits downstream of it', () => {
    expect(buildS1({ bulk: k(100), supplyPointConfirmed: true, existingPv: k(20) })[0]).toBe(120)
  })
  it('reconciliation shows the ratio and does not assume bulk ⊇ tenants (YARONA ≈ 2.5)', () => {
    const r = reconcileMonthly(Array(12).fill(100), Array(12).fill(250))
    expect(r[0]).toEqual({ month: 1, bulkKwh: 100, tenantsKwh: 250, ratio: 2.5 })
    expect(reconcileMonthly([0, ...Array(11).fill(1)], Array(12).fill(1))[0].ratio).toBeNull()
  })
})

describe('S2 (tenants)', () => {
  it('(Σ weight × meter + Σ unmetered synth) × (1 + common area)', () => {
    const s = buildS2({ tenants: [{ meters: [{ series: k(10), weight: 1 }, { series: k(4), weight: 0.5 }] }, { synth: k(6) }], commonAreaPct: 10 })
    expect(s[0]).toBeCloseTo((10 + 2 + 6) * 1.1, 12)
  })
  it('refuses weight ≤ 0 and a tenant with no basis', () => {
    expect(() => buildS2({ tenants: [{ meters: [{ series: k(1), weight: 0 }] }], commonAreaPct: 0 })).toThrow(/weight/)
    expect(() => buildS2({ tenants: [{}], commonAreaPct: 0 })).toThrow(/basis/)
    expect(() => buildS2({ tenants: [], commonAreaPct: 101 })).toThrow(/common/)
  })
})

describe('S3 (synthesis)', () => {
  it('Σ synth × (1 + common area)', () => {
    expect(buildS3({ synths: [k(1), k(2)], commonAreaPct: 50 })[0]).toBe(4.5)
  })
})

describe('S4 (monthly bills)', () => {
  const shape = k(1)
  for (let h = 0; h < 744; h++) shape[h] = h % 2 === 0 ? 1 : 3   // January alternates 1 / 3
  const kwh = [1488, ...Array(11).fill(100)]
  it('scales each month to the billed kWh', () => {
    const { series } = buildS4({ shape, monthlyKwh: kwh, referenceYear: 2027 })
    expect(monthlyEnergyKwh(series, 2027).map((x) => Math.round(x * 1e9) / 1e9)).toEqual(kwh)
    expect(series[744]).toBeCloseTo(100 / 672, 12)                   // February, 672 hours
  })
  it('billed kVA sets the monthly peak (PF 0.95) and keeps the energy', () => {
    const { series } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [3.8, ...Array(11).fill(null)], referenceYear: 2027 })
    expect(series[1]).toBeCloseTo(3.61, 10)
    expect(series[0]).toBeCloseTo(0.39, 10)
    expect(monthlyEnergyKwh(series, 2027)[0]).toBeCloseTo(1488, 9)
  })
  it('a flat month cannot take a peak: warned, unchanged', () => {
    const { warnings } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [null, 1, ...Array(10).fill(null)], referenceYear: 2027 })
    expect(warnings.join(' ')).toMatch(/month 2/)
  })
  it('billed kVA x PF BELOW the monthly mean leaves the month unchanged and warns (never inverts the shape)', () => {
    // January mean = 1,488 / 744 = 2 kW; billed 1 kVA x 0.95 = 0.95 kW < 2, so the stretch factor would be negative.
    const { series, warnings } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [1, ...Array(11).fill(null)], referenceYear: 2027 })
    expect(series[0]).toBeCloseTo(1, 12)
    expect(series[1]).toBeCloseTo(3, 12)
    expect(monthlyEnergyKwh(series, 2027)[0]).toBeCloseTo(1488, 9)
    expect(warnings.join(' ')).toMatch(/month 1: billed kVA below average demand; check PF\/kVA/)
  })
  it('after clamping and re-scaling, the warning reports the peak actually achieved', () => {
    // 10 kW wanted: s = (10 - 2) / (3 - 2) = 8, so the 1 kW hours go to -6 -> 0 and the 3 kW hours to 10;
    // re-scaled to 1,488 kWh that is x 0.4, so the peak achieved is 4 kW.
    const { series, warnings } = buildS4({ shape, monthlyKwh: kwh, monthlyKva: [10 / 0.95, ...Array(11).fill(null)], referenceYear: 2027 })
    expect(Math.max(...series.subarray(0, 744))).toBeCloseTo(4, 9)
    expect(monthlyEnergyKwh(series, 2027)[0]).toBeCloseTo(1488, 9)
    expect(warnings.join(' ')).toMatch(/month 1: .*clamped and energy re-scaled; peak achieved 4\.00 kW \(billed 10\.00 kW\)/)
  })
})
