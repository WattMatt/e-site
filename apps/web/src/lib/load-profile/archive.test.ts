// @vitest-environment node
import { describe, expect, it, vi } from 'vitest'

const libraryCalls: string[][] = []
vi.mock('./load', () => ({
  loadLibraryMeters: async (_s: unknown, ids: string[]) => { libraryCalls.push(ids); return new Map() },
}))
const { archiveSettings, listArchiveSites, loadArchiveSiteView, siteFromParam } = await import('./archive')

type M = { id: string; label: string; kind: string; site_label: string | null; shop_no: string | null }

/** A PostgREST-shaped fake of solar.meters that honours neq/eq/range. */
function fakeClient(meters: M[]) {
  const ranges: Array<[number, number]> = []
  const client = {
    schema: () => ({
      from: () => {
        let rows = meters
        const q = {
          select: () => q,
          neq: (c: keyof M, v: string) => { rows = rows.filter((r) => r[c] !== v); return q },
          eq: (c: keyof M, v: string) => { rows = rows.filter((r) => r[c] === v); return q },
          order: () => q,
          range: (a: number, b: number) => { ranges.push([a, b]); const page = rows.slice(a, b + 1); return Object.assign(Promise.resolve({ data: page, error: null }), q, { eq: (c: keyof M, v: string) => { const f = rows.filter((r) => r[c] === v).slice(a, b + 1); return Promise.resolve({ data: f, error: null }) } }) },
        }
        return q
      },
    }),
  }
  return { client: client as never, ranges }
}

const m = (i: number, site: string | null, kind = 'tenant'): M => ({ id: `m${i}`, label: `Shop ${i}`, kind, site_label: site, shop_no: null })

describe('archiveSettings', () => {
  it('keeps values in range and defaults the rest', () => {
    expect(archiveSettings({ year: '2024', pf: '0.9' })).toEqual({ referenceYear: 2024, powerFactor: 0.9 })
    expect(archiveSettings({ year: '1999', pf: '1.2' })).toEqual({ referenceYear: 2025, powerFactor: 0.95 })
    expect(archiveSettings({ year: '2024.5', pf: '0' })).toEqual({ referenceYear: 2025, powerFactor: 0.95 })
    expect(archiveSettings({})).toEqual({ referenceYear: 2025, powerFactor: 0.95 })
  })
})

describe('siteFromParam', () => {
  it('decodes an encoded segment and tolerates an already-decoded one', () => {
    expect(siteFromParam('MORONE%20(KAPANE)%20-%20KSC')).toBe('MORONE (KAPANE) - KSC')
    expect(siteFromParam('100% MALL')).toBe('100% MALL')
    expect(siteFromParam('x'.repeat(300))).toHaveLength(200)
  })
})

describe('listArchiveSites', () => {
  it('groups by site across pages, counts kinds, skips water and unlabelled meters', async () => {
    const meters = [
      ...Array.from({ length: 1200 }, (_, i) => m(i, 'BIG MALL')),
      m(2000, 'Alpha', 'bulk'), m(2001, 'Alpha'), m(2002, 'Alpha', 'water'), m(2003, null), m(2004, '  '),
    ]
    const { client, ranges } = fakeClient(meters)
    const sites = await listArchiveSites(client)
    expect(sites).toEqual([
      { site: 'Alpha', meters: 2, kinds: { bulk: 1, tenant: 1 } },
      { site: 'BIG MALL', meters: 1200, kinds: { tenant: 1200 } },
    ])
    expect(ranges.length).toBeGreaterThan(1) // read past the first 1,000 rows
  })
})

describe('loadArchiveSiteView', () => {
  it('is null for a site with no meters', async () => {
    expect(await loadArchiveSiteView(fakeClient([m(1, 'Alpha')]).client, 'Nowhere', { referenceYear: 2025, powerFactor: 0.95 })).toBeNull()
  })
  it('makes every meter a read-only library source with the role of its kind', async () => {
    libraryCalls.length = 0
    const meters = [m(1, 'Alpha', 'bulk'), m(2, 'Alpha', 'tenant'), m(3, 'Alpha', 'check'), m(4, 'Alpha', 'unknown'), m(5, 'Beta')]
    const v = await loadArchiveSiteView(fakeClient(meters).client, 'Alpha', { referenceYear: 2025, powerFactor: 0.95 })
    expect(libraryCalls).toEqual([['m1', 'm2', 'm3', 'm4']])
    expect(v?.canEdit).toBe(false)
    expect(v?.cost).toBeNull()
    expect(v?.projectName).toBe('Alpha')
    expect(v?.sources.map((s) => [s.label, s.role])).toEqual([['Shop 1', 'bulk'], ['Shop 2', 'tenant'], ['Shop 3', 'check'], ['Shop 4', 'submain']])
  })
})
