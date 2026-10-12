/**
 * Measured tenant benchmarks as stored on a tenant-schedule source (params.benchmarks) and applied
 * when the profile is composed. Computing them reads the library's readings (benchmarks.ts, on
 * request); composing only expands the stored shapes, so the page stays fast.
 *
 * params.basis: 'measured' = estimate each tenant from the library's measured stores of its brand
 * where there are any; anything else (and every source made before 2026-10-06) = generic figures.
 */
import { benchmarkDensity, benchmarkKey, type Benchmark, type BenchmarkExclusion, type TenantSynthInput } from '@esite/shared/load-profile'

export interface StoredBenchmarks {
  version: 1
  computedAt: string
  referenceYear: number
  byKey: Record<string, Benchmark>
  /** Stores left out of each brand's benchmark, with the reason. */
  excluded: Record<string, BenchmarkExclusion[]>
  /** Tenant brands with no qualifying measured store in the library. */
  unmatched: string[]
  /** Brands that had more stores than were read (MAX_STORES_PER_BRAND). */
  capped: string[]
}

export type TenantBasis = 'measured' | 'generic'

export function basisOf(params: Record<string, unknown> | null): TenantBasis {
  return params?.basis === 'measured' ? 'measured' : 'generic'
}

export function storedBenchmarks(params: Record<string, unknown> | null): StoredBenchmarks | null {
  const b = params?.benchmarks as StoredBenchmarks | undefined
  return b && b.version === 1 && b.byKey && typeof b.byKey === 'object' ? b : null
}

/** Each tenant whose brand has a stored benchmark is estimated from it, per m² of its own area. */
export function applyBenchmarks(tenants: TenantSynthInput[], stored: StoredBenchmarks | null, referenceYear: number): TenantSynthInput[] {
  if (!stored) return tenants
  const density = new Map<string, number>()
  return tenants.map((t) => {
    const key = benchmarkKey(t.matchName ?? t.label)
    const b = key ? stored.byKey[key] : undefined
    if (!b) return t
    let d = density.get(key)
    if (d === undefined) density.set(key, (d = benchmarkDensity(b, referenceYear)))
    return { ...t, benchmark: { key, shape: b.shape, densityWPerM2: d } }
  })
}
