// @vitest-environment node
import { describe, expect, it } from 'vitest'
import { buildBenchmark, type Benchmark } from '@esite/shared/load-profile'
import { QUALITY, type Reading } from '@esite/shared/meter-data'
import { applyBenchmarks, basisOf, storedBenchmarks, type StoredBenchmarks } from './benchmark-store'
import { composeView, type SourceRow } from './compose'

function readings(kw: (h: number) => number): Reading[] {
  const out: Reading[] = []
  const start = Date.UTC(2025, 0, 1) - 7_200_000
  for (let t = start + 1_800_000; t <= start + 365 * 86_400_000; t += 1_800_000) {
    out.push({ tsEnd: t, value: kw(Math.floor(((t - 1_800_000 - start) % 86_400_000) / 3_600_000)), quality: QUALITY.OK as never })
  }
  return out
}
/** Measured Shoprite stores: 3,500 m² and 3,000 m², open 08:00–20:00. */
const shoprite: Benchmark = buildBenchmark('shoprite', [
  { meterId: 'a', site: 'A MALL', label: 'SHOPRITE', areaM2: 3500, intervalMin: 30, readings: readings((h) => (h >= 8 && h < 20 ? 500 : 100)) },
  { meterId: 'b', site: 'B MALL', label: 'SHOPRITE', areaM2: 3000, intervalMin: 30, readings: readings((h) => (h >= 8 && h < 20 ? 400 : 90)) },
], 2025).benchmark!
const stored: StoredBenchmarks = { version: 1, computedAt: '2026-10-06T10:00:00.000Z', referenceYear: 2025, byKey: { shoprite }, excluded: {}, unmatched: ['kfc'], capped: [] }

const schedule = (params: Record<string, unknown>): SourceRow => ({
  id: 'ts', kind: 'tenant_schedule', label: 'Tenant schedule estimate', included: true, file_name: null, format: null, source_column: null, kva_column: null,
  interval_min: null, first_ts_end: null, values: null, quality: null, kva_values: null, conversion: null, quality_report: null, params, role: 'tenant', solar_meter_id: null,
})
const tenants = [
  { label: '1 SHOPRITE', matchName: 'Shoprite', areaM2: 2500, category: 'national' as const },
  { label: '2 KFC', matchName: 'KFC', areaM2: 200, category: 'fast_food' as const },
]

describe('benchmark-store', () => {
  it('basis is measured only when the source says so (sources made before benchmarks stay generic)', () => {
    expect(basisOf({ basis: 'measured' })).toBe('measured')
    expect(basisOf({ commonAreaPct: 0 })).toBe('generic')
    expect(basisOf(null)).toBe('generic')
  })
  it('reads only a well-formed stored set', () => {
    expect(storedBenchmarks({ benchmarks: stored })).toBe(stored)
    expect(storedBenchmarks({ benchmarks: { version: 2 } })).toBeNull()
    expect(storedBenchmarks({})).toBeNull()
  })
  it('matches each tenant to its brand by its own name, not its schedule label', () => {
    const out = applyBenchmarks(tenants, stored, 2025)
    expect(out[0].benchmark?.key).toBe('shoprite')
    expect(out[0].benchmark!.densityWPerM2).toBeGreaterThan(0)
    expect(out[1].benchmark).toBeUndefined()
  })
})

describe('composeView with a measured tenant estimate', () => {
  const run = (params: Record<string, unknown>) => composeView({ referenceYear: 2025, powerFactor: 0.95, nmdKva: null, sources: [schedule(params)], tenants, costing: null })

  it('the 2,500 m² Shoprite gets the measured median kWh per m² over its own area; KFC stays generic', () => {
    const v = run({ commonAreaPct: 0, basis: 'measured', benchmarks: stored })
    const est = v.sources[0].tenantEstimate!
    expect(est.basis).toBe('measured')
    const s = est.lines.find((l) => l.label === '1 SHOPRITE')!
    expect(s.basis).toBe('benchmark')
    expect(s.brand).toBe('SHOPRITE')
    expect(s.annualKwh / 2500).toBeCloseTo(shoprite.kwhPerM2.median, 0)
    expect(est.lines.find((l) => l.label === '2 KFC')!.basis).toBe('generic')
    expect(est.brands).toHaveLength(1)
    expect(est.brands[0]).toMatchObject({ key: 'shoprite', n: 2 })
    expect(est.unmatched).toEqual(['kfc'])
    expect(v.sources[0].detail).toMatch(/1 from measured stores of their brand, 1 from generic figures/)
  })

  it('the generic basis ignores stored benchmarks', () => {
    const v = run({ commonAreaPct: 0, basis: 'generic', benchmarks: stored })
    expect(v.sources[0].tenantEstimate!.lines.every((l) => l.basis === 'generic')).toBe(true)
  })

  it('measured and generic differ for the Shoprite: the area is no longer multiplied by a category default', () => {
    const m = run({ commonAreaPct: 0, basis: 'measured', benchmarks: stored }).sources[0].tenantEstimate!.lines[0].annualKwh
    const g = run({ commonAreaPct: 0 }).sources[0].tenantEstimate!.lines[0].annualKwh
    expect(m).not.toBeCloseTo(g, -2)
  })
})
