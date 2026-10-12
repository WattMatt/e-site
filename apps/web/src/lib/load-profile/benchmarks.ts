import 'server-only'
/**
 * Computes measured tenant benchmarks from the org's Solar meter library, through the CALLER's
 * session (Solar RLS decides what is readable; an org without a library gets none, and every
 * tenant stays on the generic figures). Brands are read one at a time so only one brand's
 * readings are in memory.
 */
import { benchmarkKey, buildBenchmark, type Benchmark, type BenchmarkCandidate, type BenchmarkExclusion } from '@esite/shared/load-profile'
import type { StoredBenchmarks } from './benchmark-store'
import { loadLibraryMeters, type AnyClient } from './load'

/** Stores read per brand: enough for a median and a spread, bounded so a refresh stays within a request. */
export const MAX_STORES_PER_BRAND = 12
/** Brands read at once: each holds at most MAX_STORES_PER_BRAND stores' latest 400 days in memory. */
const BRAND_CONCURRENCY = 4

type MeterRow = { id: string; label: string; site_label: string | null; area_m2: number | string | null }

async function tenantMeters(supabase: AnyClient): Promise<MeterRow[]> {
  const out: MeterRow[] = []
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.schema('solar').from('meters').select('id, label, site_label, area_m2').eq('kind', 'tenant').order('id').range(from, from + 999)
    if (error) throw new Error(`library meters: ${error.message}`)
    out.push(...((data ?? []) as MeterRow[]))
    if (!data || data.length < 1000) return out
  }
}

export async function computeTenantBenchmarks(supabase: AnyClient, tenantNames: Array<string | null | undefined>, referenceYear: number, now = new Date()): Promise<StoredBenchmarks> {
  const wanted = new Set(tenantNames.map(benchmarkKey).filter(Boolean))
  const byBrand = new Map<string, MeterRow[]>()
  for (const m of await tenantMeters(supabase)) {
    const key = benchmarkKey(m.label)
    if (!wanted.has(key)) continue
    const list = byBrand.get(key) ?? []
    list.push(m)
    byBrand.set(key, list)
  }
  const byKey: Record<string, Benchmark> = {}
  const excluded: Record<string, BenchmarkExclusion[]> = {}
  const capped: string[] = []
  const one = async (key: string, all: MeterRow[]) => {
    // Stores with a recorded area first: without one a store cannot be a per-m² benchmark.
    const ranked = [...all].sort((a, b) => Number(b.area_m2 != null) - Number(a.area_m2 != null) || (a.site_label ?? '').localeCompare(b.site_label ?? ''))
    const read = ranked.slice(0, MAX_STORES_PER_BRAND)
    if (ranked.length > read.length) capped.push(key)
    const withArea = read.filter((m) => m.area_m2 != null && Number(m.area_m2) > 0)
    const lib = withArea.length ? await loadLibraryMeters(supabase, withArea.map((m) => m.id)) : new Map()
    const noData: BenchmarkExclusion[] = []
    const candidates: BenchmarkCandidate[] = []
    for (const m of read) {
      const site = m.site_label ?? 'Solar library'
      const area = m.area_m2 == null ? null : Number(m.area_m2)
      const d = lib.get(m.id)
      if (area !== null && area > 0 && !d) { noData.push({ meterId: m.id, site, label: m.label, reason: 'no readings' }); continue }
      candidates.push({ meterId: m.id, site, label: m.label, areaM2: area, intervalMin: d?.intervalMin ?? 30, readings: d?.kw ?? [] })
    }
    const r = buildBenchmark(key, candidates, referenceYear)
    if (r.benchmark) byKey[key] = r.benchmark
    const ex = [...noData, ...r.excluded]
    if (ex.length) excluded[key] = ex
  }
  const brands = [...byBrand].sort(([a], [b]) => a.localeCompare(b))
  for (let i = 0; i < brands.length; i += BRAND_CONCURRENCY) {
    await Promise.all(brands.slice(i, i + BRAND_CONCURRENCY).map(([key, all]) => one(key, all)))
  }
  capped.sort()
  return {
    version: 1,
    computedAt: now.toISOString(),
    referenceYear,
    byKey,
    excluded,
    unmatched: [...wanted].filter((k) => !byKey[k]).sort(),
    capped,
  }
}
