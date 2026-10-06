import { describe, it, expect, vi } from 'vitest'
import { loadYearTariffList } from './explorer-data'
import type { AnyClient } from './admin-gate'

/**
 * A PostgREST stand-in: every read is capped at `maxRows` whatever .range()
 * asks for, the way the live API caps at max_rows. Records the filters each
 * table read was given.
 */
function fakeClient(tables: Record<string, Array<Record<string, unknown>>>, opts: { maxRows?: number; failCharges?: boolean } = {}) {
  const calls: Array<{ table: string; select: string; eq: Array<[string, unknown]>; range: [number, number] | null }> = []
  const client = {
    schema: () => ({
      from: (table: string) => {
        const call = { table, select: '', eq: [] as Array<[string, unknown]>, range: null as [number, number] | null }
        calls.push(call)
        const q = {
          select: (s: string) => { call.select = s; return q },
          eq: (k: string, v: unknown) => { call.eq.push([k, v]); return q },
          order: () => q,
          range: (a: number, b: number) => { call.range = [a, b]; return q },
          then: (res: (v: unknown) => unknown) => {
            if (table === 'charge' && opts.failCharges) return Promise.resolve({ data: null, error: { code: 'XX000' } }).then(res)
            const all = tables[table] ?? []
            const [a, b] = call.range ?? [0, all.length - 1]
            const slice = all.slice(a, Math.min(b + 1, a + (opts.maxRows ?? 1000)))
            return Promise.resolve({ data: slice, error: null }).then(res)
          },
        }
        return q
      },
    }),
  }
  return { client: client as unknown as AnyClient, calls }
}

const tariff = (id: string) => ({ id, name: `T ${id}`, code: null, family: null, category: 'domestic', structure: 'flat', metering: 'conventional', is_legacy: false })

describe('loadYearTariffList', () => {
  it('reads every charge of the year even when the API caps each read below the page size', async () => {
    // 2,500 charges; the cap (700) is below the page (1,000). Stepping by the page size would skip rows 700-999, where the outlier sits.
    const charges = Array.from({ length: 2500 }, (_, i) => ({ id: `c${String(i).padStart(5, '0')}`, tariff_id: i < 2499 ? 'a' : 'b', component: 'energy', unit: 'c_per_kWh', amount_excl_vat: i === 850 ? 999.5 : 100 }))
    const { client, calls } = fakeClient({ tariff: [tariff('a'), tariff('b')], charge: charges }, { maxRows: 700 })
    const rows = await loadYearTariffList(client, 'year-1')
    expect(rows.find((r) => r.id === 'a')!.headline!.energy).toEqual({ min: 100, max: 999.5 })
    expect(rows.find((r) => r.id === 'b')!.headline!.energy).toEqual({ min: 100, max: 100 })
    const chargeCalls = calls.filter((c) => c.table === 'charge')
    expect(chargeCalls.every((c) => c.eq.some(([k, v]) => k === 'tariff.tariff_year_id' && v === 'year-1'))).toBe(true)
    expect(chargeCalls[0].select).not.toContain('*')
  })
  it('a failed charge read still lists the tariffs, without figures', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {})
    const { client } = fakeClient({ tariff: [tariff('a')] }, { failCharges: true })
    const rows = await loadYearTariffList(client, 'year-1')
    expect(rows.map((r) => [r.id, r.headline])).toEqual([['a', null]])
  })
})
