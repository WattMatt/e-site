import { describe, expect, it } from 'vitest'
import { QUALITY, type Reading } from '../meter-data/types'
import { benchmarkDensity, benchmarkKey, buildBenchmark, BENCHMARK_RULES, type BenchmarkCandidate } from './benchmark'
import { tenantScheduleSeries } from './synthetic'

const sum = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }

/** 30-min readings over [fromDay, toDay) of 2025; kw(hourOfDay) gives the level. */
function readings(kw: (h: number) => number, fromDay = 0, toDay = 365): Reading[] {
  const out: Reading[] = []
  const start = Date.UTC(2025, 0, 1) - 7_200_000 // SAST midnight
  for (let t = start + fromDay * 86_400_000 + 1_800_000; t <= start + toDay * 86_400_000; t += 1_800_000) {
    const h = Math.floor(((t - 1_800_000 - start) % 86_400_000) / 3_600_000)
    out.push({ tsEnd: t, value: kw(h), quality: QUALITY.OK as never })
  }
  return out
}
const store = (id: string, areaM2: number | null, kw: (h: number) => number, days: [number, number] = [0, 365]): BenchmarkCandidate => ({
  meterId: id, site: `SITE ${id}`, label: 'SHOPRITE', areaM2, intervalMin: 30, readings: readings(kw, days[0], days[1]),
})

describe('benchmarkKey', () => {
  it.each([
    ['SHOPRITE', 'shoprite'],
    ['Shoprite Supermarket', 'shoprite'],
    ['SHOPRITES', 'shoprite'],
    ['SHOPRITE LIQUOR', 'shoprite liquor'],
    ['SHOPRITES LIQUOR', 'shoprite liquor'],
    ['SHOPRITE LIQUOR SHOP', 'shoprite liquor'],
    ['BOXER SUPERSTORES', 'boxer'],
    ['Boxer Superstore', 'boxer'],
    ['Pick n Pay', 'pick n pay'],
    ['PNP', 'pick n pay'],
    ['Pick & Pay', 'pick n pay'],
    ['TOTAL SPORTS_A', 'total sport'],
    ['Checkers Hyper', 'checker hyper'],
    ['Checkers', 'checker'],
    ['Checkers Store', 'checker'],
    ['Mr Price (Pty) Ltd', 'mr price'],
    ['Studio 88', 'studio 88'],
    ['Studio W', 'studio'],
    ['Capitec ATM 002', 'capitec atm'],
    ['Shop 12 Boxer', 'boxer'],
  ])('%s → %s', (name, key) => expect(benchmarkKey(name)).toBe(key))

  it('keeps liquor stores and hypermarkets apart from the main brand', () => {
    expect(benchmarkKey('SHOPRITE LIQUOR')).not.toBe(benchmarkKey('SHOPRITE'))
    expect(benchmarkKey('Checkers Hyper')).not.toBe(benchmarkKey('Checkers'))
  })
  it.each(['', '   ', null, undefined, 'VACANT', 'Vacant shop 12', 'SPARE', '12', 'DB-09 SPARE'])('%s has no key', (name) => expect(benchmarkKey(name)).toBe(''))
})

describe('buildBenchmark', () => {
  it('is per m²: two stores of different size and intensity give the median intensity', () => {
    // A: 100 kW on 1,000 m² = 100 W/m² = 876 kWh/m²/yr. B: 100 kW on 2,000 m² = 50 W/m² = 438.
    const r = buildBenchmark('shoprite', [store('a', 1000, () => 100), store('b', 2000, () => 100)], 2025)
    expect(r.excluded).toEqual([])
    const b = r.benchmark!
    expect(b.n).toBe(2)
    expect(b.kwhPerM2.median).toBeCloseTo(657, 0)
    expect(b.kwhPerM2.low).toBeCloseTo(438, 0)
    expect(b.kwhPerM2.high).toBeCloseTo(876, 0)
    expect(b.stores.map((s) => Math.round(s.kwhPerM2))).toEqual([876, 438])
  })

  it('excludes, with a reason, a store with no area, too little data, or an implausible peak', () => {
    const r = buildBenchmark('shoprite', [
      store('ok', 1000, () => 100),
      store('noarea', null, () => 100),
      store('short', 1000, () => 100, [0, 200]),
      store('spike', 1000, (h) => (h === 3 ? 26_000 : 100)),
    ], 2025)
    expect(r.benchmark).toBeNull() // one qualifying store is not a benchmark
    const why = Object.fromEntries(r.excluded.map((e) => [e.site, e.reason]))
    expect(why['SITE noarea']).toMatch(/no shop area/)
    expect(why['SITE short']).toMatch(/days of data/)
    expect(why['SITE spike']).toMatch(/peak/)
    expect(why['SITE ok']).toMatch(/only qualifying store/)
  })

  it('two qualifying stores make a benchmark', () => {
    expect(buildBenchmark('shoprite', [store('a', 1000, () => 100), store('b', 1200, () => 100), store('c', null, () => 1)], 2025).benchmark?.n).toBe(2)
  })

  it('returns no benchmark when no store qualifies', () => {
    const r = buildBenchmark('shoprite', [store('noarea', null, () => 100)], 2025)
    expect(r.benchmark).toBeNull()
    expect(r.excluded).toHaveLength(1)
  })

  it('keeps the measured daily pattern: open hours carry the load', () => {
    const b = buildBenchmark('shoprite', [store('a', 1000, (h) => (h >= 8 && h < 20 ? 150 : 30)), store('b', 2000, (h) => (h >= 8 && h < 20 ? 300 : 60))], 2025).benchmark!
    const wd = b.shape.profiles.weekday
    expect(wd[12] / wd[2]).toBeCloseTo(5, 1)
    expect(b.peakWPerM2.median).toBeCloseTo(150, 0)
  })

  it('stays inside the rules it states', () => {
    expect(BENCHMARK_RULES.minDays).toBeGreaterThanOrEqual(300)
    expect(BENCHMARK_RULES.maxPeakWPerM2).toBeLessThan(26_000)
  })
})

describe('a benchmark scaled to the tenant schedule area (the owner question, 2026-10-06)', () => {
  const b = buildBenchmark('shoprite', [store('a', 3500, (h) => (h >= 8 && h < 20 ? 500 : 100)), store('b', 3000, (h) => (h >= 8 && h < 20 ? 400 : 90))], 2025).benchmark!

  it('a 2,500 m² and a 3,500 m² Shoprite get profiles in proportion to their areas', () => {
    const t = tenantScheduleSeries([
      { label: 'Shoprite 2500', areaM2: 2500, category: null, benchmark: { shape: b.shape, densityWPerM2: benchmarkDensity(b, 2025) } },
    ], 2025, { commonAreaPct: 0 })
    const u = tenantScheduleSeries([
      { label: 'Shoprite 3500', areaM2: 3500, category: null, benchmark: { shape: b.shape, densityWPerM2: benchmarkDensity(b, 2025) } },
    ], 2025, { commonAreaPct: 0 })
    expect(sum(t.series) / sum(u.series)).toBeCloseTo(2500 / 3500, 6)
    expect(t.lines[0].peakKw / u.lines[0].peakKw).toBeCloseTo(2500 / 3500, 6)
  })

  it('a tenant built from the benchmark uses the median measured kWh per m²', () => {
    const t = tenantScheduleSeries([{ label: 'S', areaM2: 2500, category: null, benchmark: { shape: b.shape, densityWPerM2: benchmarkDensity(b, 2025) } }], 2025, { commonAreaPct: 0 })
    expect(sum(t.series) / 2500).toBeCloseTo(b.kwhPerM2.median, 0)
    expect(t.lines[0].basis).toBe('benchmark')
  })

  it('a tenant with no benchmark keeps the generic figures', () => {
    const t = tenantScheduleSeries([{ label: 'Unknown', areaM2: 100, category: 'standard' }], 2025, { commonAreaPct: 0 })
    expect(t.lines[0].basis).toBe('generic')
  })
})
