import { describe, it, expect } from 'vitest'
import type { Reading } from '../../../meter-data/types'
import { buildSiteLoad, type BuildMeter, type BuildSiteLoadInput, type BuildTenant } from './build-site-load'
import { monthlyEnergyKwh } from './site-series'

function readings(start: string, days: number, intervalMin: number, kw: number): Reading[] {
  const t0 = Date.parse(`${start}T00:00:00+02:00`)
  const n = (days * 24 * 60) / intervalMin
  const out: Reading[] = []
  for (let i = 1; i <= n; i++) out.push({ tsEnd: t0 + i * intervalMin * 60_000, value: kw, quality: 0 })
  return out
}
const meter = (meterId: string, kw: number, over: Partial<BuildMeter> = {}): BuildMeter => ({
  meterId, label: meterId, kind: 'tenant', supplyPointConfirmed: false, serials: [],
  primary: { readings: readings('2025-01-01', 365, 30, kw), intervalMin: 30 }, kva: null, existingPv: null, ...over,
})
const tenant = (nodeId: string, over: Partial<BuildTenant> = {}): BuildTenant => ({
  nodeId, label: nodeId, areaM2: 100, category: 'standard', source: 'metered', meters: [], archetype: null,
  densityOverrideWPerM2: null, boDate: null, ...over,
})
const base = (over: Partial<BuildSiteLoadInput> = {}): BuildSiteLoadInput => ({
  basis: 'S2', referenceYear: null, fallbackYear: 2025, commonAreaPct: 0, diversityFactor: 1,
  tenants: [], meters: [], lines: [], bills: null, ...over,
})
const total = (s: Float64Array) => s.reduce((a, b) => a + b, 0)

describe('buildSiteLoad — S2 (sum of tenants)', () => {
  it('one metered tenant, a flat 10 kW year: the series is that year', () => {
    const r = buildSiteLoad(base({ meters: [meter('m1', 10)], tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }] })] }))
    expect(r.basis).toBe('S2')
    expect(r.referenceYear).toBe(2025)
    expect(total(r.series)).toBeCloseTo(87_600, 0)
    expect(r.coverage).toMatchObject({ metered: 1, synthesised: 0, unassigned: 0, fullYearFromData: true, peakSource: 'hourly' })
    expect(r.tenants[0]).toMatchObject({ nodeId: 't1', source: 'metered' })
    expect(r.tenants[0].annualKwh).toBeCloseTo(87_600, 0)
  })

  it('applies the common-area allowance and explicit weights (sum, not average)', () => {
    const r = buildSiteLoad(base({
      commonAreaPct: 10,
      meters: [meter('m1', 10), meter('m2', 10)],
      tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }, { meterId: 'm2', weight: 0.5 }] })],
    }))
    expect(r.series[100]).toBeCloseTo(15 * 1.1)
  })

  it('double-count guard: the parent is dropped, its tenant is covered by the children', () => {
    const r = buildSiteLoad(base({
      meters: [meter('P', 30), meter('C', 10)],
      tenants: [tenant('tA', { meters: [{ meterId: 'P', weight: 1 }] }), tenant('tB', { meters: [{ meterId: 'C', weight: 1 }] })],
      lines: [{ fromMeterId: 'P', toMeterId: 'C' }],
    }))
    expect(r.series[500]).toBeCloseTo(10)
    expect(r.coverage.coveredByChildren).toBe(1)
    expect(r.tenants.find((t) => t.nodeId === 'tA')?.source).toBe('covered_by_children')
    expect(r.checks.some((c) => c.key === 'double_count:P')).toBe(true)
    expect(r.reconciliation.parents[0].months.every((m) => m.flagged)).toBe(true)
  })

  it('never counts a solar/generator/check/water meter as load', () => {
    const r = buildSiteLoad(base({
      meters: [meter('pv', 40, { kind: 'solar' })],
      tenants: [tenant('t1', { meters: [{ meterId: 'pv', weight: 1 }], areaM2: 0 })],
    }))
    expect(total(r.series)).toBe(0)
    expect(r.checks.some((c) => c.key === 'excluded_kind:pv')).toBe(true)
    expect(r.basis).toBe('S3')
  })

  it('synthesises unassigned tenants and counts them', () => {
    const r = buildSiteLoad(base({ tenants: [tenant('t1', { source: 'unassigned' })] }))
    expect(r.basis).toBe('S3')
    expect(r.coverage.unassigned).toBe(1)
    expect(total(r.series)).toBeGreaterThan(0)
    expect(r.checks.some((c) => c.key.startsWith('unassigned_tenants'))).toBe(true)
  })

  it('check keys carry the count, so an acknowledgement does not survive a changed message', () => {
    const key = (r: ReturnType<typeof buildSiteLoad>, prefix: string) => r.checks.find((c) => c.key.startsWith(prefix))?.key
    const one = buildSiteLoad(base({ tenants: [tenant('t1', { source: 'unassigned' })] }))
    const two = buildSiteLoad(base({ tenants: [tenant('t1', { source: 'unassigned' }), tenant('t2', { source: 'unassigned' })] }))
    const oneAgain = buildSiteLoad(base({ tenants: [tenant('t1', { source: 'unassigned' })] }))
    expect(key(one, 'unassigned_tenants')).toBe('unassigned_tenants:1')
    expect(key(two, 'unassigned_tenants')).toBe('unassigned_tenants:2')
    expect(key(oneAgain, 'unassigned_tenants')).toBe(key(one, 'unassigned_tenants'))

    const short = (id: string) => meter(id, 10, { primary: { readings: readings('2025-01-01', 120, 30, 10), intervalMin: 30 } })
    const metered = (ids: string[]) => ids.map((id) => tenant(`t-${id}`, { meters: [{ meterId: id, weight: 1 }] }))
    const half = buildSiteLoad(base({ meters: [meter('a', 10), short('b')], tenants: metered(['a', 'b']) }))
    const third = buildSiteLoad(base({ meters: [meter('a', 10), short('b'), short('c')], tenants: metered(['a', 'b', 'c']) }))
    const halfKey = key(half, 'common_window')
    const thirdKey = key(third, 'common_window')
    expect(halfKey).toMatch(/^common_window:\d+$/)
    expect(thirdKey).toMatch(/^common_window:\d+$/)
    expect(halfKey).not.toBe(thirdKey)
  })

  it('S3 design maximum demand applies the diversity factor to the peak only', () => {
    const a = buildSiteLoad(base({ diversityFactor: 1, tenants: [tenant('t1', { source: 'synthesised' }), tenant('t2', { source: 'synthesised' })] }))
    const b = buildSiteLoad(base({ diversityFactor: 0.8, tenants: [tenant('t1', { source: 'synthesised' }), tenant('t2', { source: 'synthesised' })] }))
    expect(b.designMdKw as number).toBeCloseTo((a.designMdKw as number) * 0.8)
    expect(total(b.series)).toBeCloseTo(total(a.series))
  })

  it('a meter with under 30 days is only a shape sample', () => {
    const short = meter('s', 5, { primary: { readings: readings('2025-06-01', 10, 30, 5), intervalMin: 30 } })
    const r = buildSiteLoad(base({ meters: [short], tenants: [tenant('t1', { meters: [{ meterId: 's', weight: 1 }] })] }))
    expect(r.coverage.shapeOnlyMeters).toEqual(['s'])
    expect(r.checks.some((c) => c.key === 'shape_only:s')).toBe(true)
    expect(r.basis).toBe('S3')
  })

  it('ramps a synthesised tenant in from its BO date only inside the reference year', () => {
    const inYear = buildSiteLoad(base({ referenceYear: 2025, tenants: [tenant('t1', { source: 'synthesised', boDate: '2025-07-01' })] }))
    const jan = monthlyEnergyKwh(inYear.series, 2025)
    expect(jan[0]).toBe(0)
    expect(jan[7]).toBeGreaterThan(0)
    const later = buildSiteLoad(base({ referenceYear: 2025, tenants: [tenant('t1', { source: 'synthesised', boDate: '2027-03-01' })] }))
    expect(monthlyEnergyKwh(later.series, 2025)[0]).toBeGreaterThan(0)
  })

  it('refuses an empty tenant schedule', () => {
    expect(() => buildSiteLoad(base())).toThrow(/no_tenants|tenant schedule/)
  })
})

describe('buildSiteLoad — S1 (bulk)', () => {
  it('needs a bulk meter confirmed as the point of supply', () => {
    expect(() => buildSiteLoad(base({ basis: 'S1', meters: [meter('b', 25, { kind: 'bulk' })] }))).toThrow(/point of supply/)
  })

  it('uses the confirmed bulk series and reconciles it with Σ metered tenants', () => {
    const r = buildSiteLoad(base({
      basis: 'S1',
      meters: [meter('b', 25, { kind: 'bulk', supplyPointConfirmed: true }), meter('m1', 10)],
      tenants: [tenant('t1', { meters: [{ meterId: 'm1', weight: 1 }] })],
    }))
    expect(r.basis).toBe('S1')
    expect(r.series[1000]).toBeCloseTo(25)
    expect(r.coverage.peakSource).toBe('interval')
    expect(r.coverage.peakKw).toBe(25)
    expect(r.mdMonthly[0]).toMatchObject({ source: 'kw_over_pf' })
    expect(r.reconciliation.bulk[0].months).toHaveLength(12)
    expect(r.reconciliation.bulk[0].months[0].ratio).toBeCloseTo(0.4)
    expect(r.checks.filter((c) => c.key.startsWith('recon_bulk:b:'))).toHaveLength(12)
  })
})

describe('buildSiteLoad — S4 (monthly bills)', () => {
  it('each month holds the billed energy', () => {
    const r = buildSiteLoad(base({
      basis: 'S4', referenceYear: 2025,
      bills: { archetype: 'retail', powerFactor: 0.95, months: Array.from({ length: 12 }, () => ({ kwh: 1000, kva: null })) },
    }))
    expect(r.basis).toBe('S4')
    for (const e of monthlyEnergyKwh(r.series, 2025)) expect(e).toBeCloseTo(1000, 3)
  })

  it('refuses missing bills', () => {
    expect(() => buildSiteLoad(base({ basis: 'S4' }))).toThrow(/bills/)
  })
})
