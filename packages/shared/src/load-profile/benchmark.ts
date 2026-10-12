/**
 * Measured benchmarks: a tenant is estimated from the library's measured stores of the same brand,
 * PER SQUARE METRE, then scaled to the tenant's own area (owner, 2026-10-06: "a Shoprite of 3500 m²
 * in the database and a Shoprite of 2500 m² in the tenant schedule cannot have the same profile").
 *
 * Each qualifying store is reduced to kWh/m² a year and to its pattern relative to its own mean; the
 * benchmark is the MEDIAN intensity with the averaged pattern, compressed to the same day-type ×
 * hour × month shape as the generic archetypes so synthesis (synthesiseTenant) is unchanged. Linear
 * area scaling is an approximation (fixed loads such as a bakery do not shrink with floor area), so
 * the spread across stores is kept and shown, never just the median.
 */
import type { Reading } from '../meter-data/types'
import { expandArchetype, type ArchetypeShapeDef, type OperatingWindow } from '../services/solar/load/archetypes'
import { dayTypeOf, monthOf, referenceYearDates, type DayType } from '../services/solar/load/calendar'
import { measuredReferenceSeries } from './measured'

/** Inclusion rules. A store breaking one is listed as excluded with the reason. */
export const BENCHMARK_RULES = {
  /** Days of real readings in the latest year (the rest would be the store's own average day). */
  minDays: 335,
  /** Highest hourly demand per m². Retail runs well under 300; above this is a bad reading. */
  maxPeakWPerM2: 400,
  minKwhPerM2: 20,
  maxKwhPerM2: 2500,
  /** One store is a guess, not a benchmark: a brand needs this many qualifying stores. */
  minStores: 2,
} as const

/** A number after one of these is a unit or slot number, not part of the brand ("shop 12", "ATM 002"). */
const NUMBERED = new Set(['shop', 'shops', 'unit', 'no', 'nr', 'number', 'store', 'kiosk', 'atm', 'db', 'meter'])
const NOISE = new Set(['pty', 'ltd', 'the', 'store', 'stores', 'supermarket', 'supermarkets', 'superstore', 'superstores', 'shop', 'shops', 'outlet', 'sa', 'cc', 'inc'])
const EMPTY = new Set(['vacant', 'spare', 'unlet', 'tbc', 'tba'])
const ALIASES: Record<string, string> = { pnp: 'pick n pay', 'pick pay': 'pick n pay' }
const singular = (t: string) => (t.length > 4 && t.endsWith('s') && !t.endsWith('ss') ? t.slice(0, -1) : t)

/**
 * The benchmark a tenant or meter name belongs to: brand plus kind ("shoprite", "shoprite liquor",
 * "checker hyper"). Noise words, numbers, unit letters and plurals are dropped so "SHOPRITES" and
 * "Shoprite Supermarket" meet; liquor stores and hypermarkets stay apart from the main brand.
 * '' means no benchmark (blank, vacant, spare).
 */
export function benchmarkKey(name: string | null | undefined): string {
  if (!name) return ''
  const s = name.toLowerCase().replace(/\(.*?\)/g, ' ').replace(/&|\band\b/g, ' n ').replace(/[^a-z0-9]+/g, ' ')
  const raw = s.split(' ').filter(Boolean)
  if (raw.some((t) => EMPTY.has(t))) return ''
  // Numbers stay when they are part of the brand ("Studio 88"); unit numbers and long codes go.
  const tokens = raw
    .filter((t, i) => !(/^\d+$/.test(t) && (t.length > 2 || i === 0 || NUMBERED.has(raw[i - 1]))))
    .filter((t) => !NOISE.has(t) && !(t.length === 1 && t !== 'n'))
    .map(singular)
  const key = tokens.join(' ')
  return ALIASES[key] ?? key
}

export interface BenchmarkCandidate {
  meterId: string
  site: string
  label: string
  areaM2: number | null
  intervalMin: number
  readings: Reading[]
}
export interface BenchmarkStore { meterId: string; site: string; label: string; areaM2: number; kwhPerM2: number; peakWPerM2: number; days: number }
export interface BenchmarkRange { median: number; low: number; high: number }
export interface Benchmark {
  key: string
  label: string
  n: number
  stores: BenchmarkStore[]
  /** Median, and P25–P75 from four stores up (min–max below that). */
  kwhPerM2: BenchmarkRange
  peakWPerM2: BenchmarkRange
  shape: ArchetypeShapeDef
}
export interface BenchmarkExclusion { meterId: string; site: string; label: string; reason: string }

const r1 = (v: number) => Math.round(v * 10) / 10
const r4 = (v: number) => Math.round(v * 10_000) / 10_000
const total = (a: ArrayLike<number>) => { let s = 0; for (let i = 0; i < a.length; i++) s += a[i]; return s }
const peak = (a: ArrayLike<number>) => { let m = 0; for (let i = 0; i < a.length; i++) if (a[i] > m) m = a[i]; return m }

function quantile(sorted: number[], q: number): number {
  const p = (sorted.length - 1) * q
  const lo = Math.floor(p)
  return sorted[lo] + (sorted[Math.min(lo + 1, sorted.length - 1)] - sorted[lo]) * (p - lo)
}
function range(xs: number[]): BenchmarkRange {
  const s = [...xs].sort((a, b) => a - b)
  const wide = s.length < 4
  return { median: r1(quantile(s, 0.5)), low: r1(wide ? s[0] : quantile(s, 0.25)), high: r1(wide ? s[s.length - 1] : quantile(s, 0.75)) }
}

const TYPES: DayType[] = ['weekday', 'saturday', 'sunday', 'holiday']

/** The averaged relative pattern (8760 h, mean ≈ 1) → day-type profiles × monthly multipliers. */
function compress(avg: Float64Array, referenceYear: number): ArchetypeShapeDef {
  const dates = referenceYearDates(referenceYear)
  const mSum = new Float64Array(12)
  const mN = new Float64Array(12)
  dates.forEach((d, di) => { for (let h = 0; h < 24; h++) { mSum[monthOf(d) - 1] += avg[di * 24 + h]; mN[monthOf(d) - 1]++ } })
  const overall = total(avg) / avg.length
  const seasonal = Array.from(mSum, (s, m) => (mN[m] && overall > 0 ? s / mN[m] / overall : 1))
  const acc = Object.fromEntries(TYPES.map((t) => [t, { s: new Float64Array(24), n: 0 }])) as Record<DayType, { s: Float64Array; n: number }>
  dates.forEach((d, di) => {
    const e = acc[dayTypeOf(d)]
    const k = seasonal[monthOf(d) - 1] || 1
    for (let h = 0; h < 24; h++) e.s[h] += avg[di * 24 + h] / k
    e.n++
  })
  const prof = (t: DayType) => { const e = acc[t].n ? acc[t] : acc.sunday.n ? acc.sunday : acc.weekday; return Array.from(e.s, (v) => r4(v / e.n)) }
  const all: OperatingWindow = [0, 24]
  return {
    profiles: { weekday: prof('weekday'), saturday: prof('saturday'), sunday: prof('sunday'), holiday: prof('holiday') },
    operating: { weekday: all, saturday: all, sunday: all, holiday: all },
    seasonal: seasonal.map(r4),
  }
}

export function buildBenchmark(key: string, candidates: BenchmarkCandidate[], referenceYear: number): { benchmark: Benchmark | null; excluded: BenchmarkExclusion[] } {
  const excluded: BenchmarkExclusion[] = []
  const kept: Array<{ store: BenchmarkStore; series: Float64Array }> = []
  for (const c of candidates) {
    const out = (reason: string) => excluded.push({ meterId: c.meterId, site: c.site, label: c.label, reason })
    if (!(c.areaM2 && c.areaM2 > 0)) { out('no shop area recorded'); continue }
    let m
    try { m = measuredReferenceSeries(c.readings, c.intervalMin, referenceYear) } catch (e) { out(e instanceof Error ? e.message : 'no usable readings'); continue }
    const days = Math.floor((m.series.length - m.ownShapeFilledHours) / 24)
    if (days < BENCHMARK_RULES.minDays) { out(`only ${days} days of data in its latest year (needs ${BENCHMARK_RULES.minDays})`); continue }
    const kwhPerM2 = total(m.series) / c.areaM2
    const peakWPerM2 = (peak(m.series) * 1000) / c.areaM2
    if (peakWPerM2 > BENCHMARK_RULES.maxPeakWPerM2) { out(`implausible peak of ${Math.round(peakWPerM2)} W/m² (a bad reading; the limit is ${BENCHMARK_RULES.maxPeakWPerM2})`); continue }
    if (kwhPerM2 < BENCHMARK_RULES.minKwhPerM2 || kwhPerM2 > BENCHMARK_RULES.maxKwhPerM2) { out(`implausible ${Math.round(kwhPerM2)} kWh/m² a year`); continue }
    kept.push({ store: { meterId: c.meterId, site: c.site, label: c.label, areaM2: c.areaM2, kwhPerM2: r1(kwhPerM2), peakWPerM2: r1(peakWPerM2), days }, series: m.series })
  }
  if (kept.length < BENCHMARK_RULES.minStores) {
    for (const k of kept) excluded.push({ meterId: k.store.meterId, site: k.store.site, label: k.store.label, reason: `the only qualifying store of its brand (a benchmark needs ${BENCHMARK_RULES.minStores})` })
    return { benchmark: null, excluded }
  }
  // Each store's pattern relative to its own mean, so a big store does not outweigh a small one.
  const avg = new Float64Array(kept[0].series.length)
  for (const k of kept) {
    const mean = total(k.series) / k.series.length
    for (let i = 0; i < avg.length; i++) avg[i] += k.series[i] / mean / kept.length
  }
  return {
    benchmark: {
      key,
      label: candidates.find((c) => c.meterId === kept[0].store.meterId)?.label ?? key,
      n: kept.length,
      stores: kept.map((k) => k.store),
      kwhPerM2: range(kept.map((k) => k.store.kwhPerM2)),
      peakWPerM2: range(kept.map((k) => k.store.peakWPerM2)),
      shape: compress(avg, referenceYear),
    },
    excluded,
  }
}

/** W/m² that, with the benchmark's shape, gives the median kWh/m² over the reference year. */
export function benchmarkDensity(b: Pick<Benchmark, 'kwhPerM2' | 'shape'>, referenceYear: number): number {
  const s = total(expandArchetype(b.shape, referenceYear))
  return s > 0 ? (b.kwhPerM2.median * 1000) / s : 0
}
