// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'
import { QUALITY, type Reading } from '@esite/shared/meter-data'

function readings(kw: number, days = 365): Reading[] {
  const out: Reading[] = []
  const start = Date.UTC(2025, 0, 1) - 7_200_000
  for (let t = start + 1_800_000; t <= start + days * 86_400_000; t += 1_800_000) out.push({ tsEnd: t, value: kw, quality: QUALITY.OK as never })
  return out
}

const libraryCalls: string[][] = []
vi.mock('./load', () => ({
  loadLibraryMeters: async (_s: unknown, ids: string[]) => {
    libraryCalls.push(ids)
    const m = new Map()
    for (const id of ids) if (id !== 'nodata') m.set(id, { label: id, kind: 'tenant', siteLabel: null, intervalMin: 30, kw: readings(id === 'short' ? 100 : 300, id === 'short' ? 100 : 365), kva: null })
    return m
  },
}))
const { computeTenantBenchmarks, MAX_STORES_PER_BRAND } = await import('./benchmarks')

type M = { id: string; label: string; site_label: string | null; area_m2: number | null }
function client(meters: M[]) {
  return {
    schema: () => ({
      from: () => {
        const q = {
          select: () => q, eq: () => q, order: () => q,
          range: (a: number, b: number) => Promise.resolve({ data: meters.slice(a, b + 1), error: null }),
        }
        return q
      },
    }),
  } as never
}

describe('computeTenantBenchmarks', () => {
  it('reads only the brands in the schedule, reports stores left out and brands with no store', async () => {
    libraryCalls.length = 0
    const r = await computeTenantBenchmarks(client([
      { id: 's1', label: 'SHOPRITE', site_label: 'A', area_m2: 3000 },
      { id: 's2', label: 'Shoprite Supermarket', site_label: 'B', area_m2: 2500 },
      { id: 'noarea', label: 'SHOPRITE', site_label: 'C', area_m2: null },
      { id: 'nodata', label: 'SHOPRITE', site_label: 'D', area_m2: 2000 },
      { id: 'short', label: 'SHOPRITE', site_label: 'E', area_m2: 2000 },
      { id: 'liq', label: 'SHOPRITE LIQUOR', site_label: 'A', area_m2: 300 },
      { id: 'kfc', label: 'KFC', site_label: 'A', area_m2: 200 },
    ]), ['Shoprite', 'Boxer', null], 2025, new Date('2026-10-06T00:00:00Z'))
    expect(Object.keys(r.byKey)).toEqual(['shoprite'])
    expect(r.byKey.shoprite.n).toBe(2)
    // Liquor and KFC are not in the schedule, so they are never read; the store with no area is not read either.
    expect(libraryCalls.flat().sort()).toEqual(['nodata', 's1', 's2', 'short'])
    const why = Object.fromEntries(r.excluded.shoprite.map((e) => [e.site, e.reason]))
    expect(why).toMatchObject({ C: expect.stringMatching(/no shop area/), D: 'no readings', E: expect.stringMatching(/days of data/) })
    expect(r.unmatched).toEqual(['boxer'])
    expect(r.computedAt).toBe('2026-10-06T00:00:00.000Z')
  })

  it(`reads at most ${MAX_STORES_PER_BRAND} stores of a brand and says so`, async () => {
    libraryCalls.length = 0
    const many = Array.from({ length: MAX_STORES_PER_BRAND + 3 }, (_, i) => ({ id: `m${i}`, label: 'BOXER', site_label: `S${i}`, area_m2: 2000 }))
    const r = await computeTenantBenchmarks(client(many), ['Boxer Superstores'], 2025)
    expect(libraryCalls.flat()).toHaveLength(MAX_STORES_PER_BRAND)
    expect(r.capped).toEqual(['boxer'])
    expect(r.byKey.boxer.n).toBe(MAX_STORES_PER_BRAND)
  })
})
