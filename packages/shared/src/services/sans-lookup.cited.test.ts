/**
 * The derating calculator reads its factors from the legacy tables and cites
 * each one to the SANS 10142-1:2021 cell it equals, read from the extracted
 * model. Fixture values below are the cited ones (SANS 10142-1:2021 Ed 3.1):
 * Table 6.13 printed p.120 (PDF p.124), Table 6.16 printed p.128 (PDF p.132),
 * Table 6.10 printed p.118 (PDF p.122).
 */
import { describe, expect, it } from 'vitest'
import { lookupDeratingFactors } from './sans-lookup.service'
import type { TypedSupabaseClient } from '@esite/db'

type Row = { sort_key: number; row_data: Record<string, unknown>; citation?: Record<string, unknown> | null }

function stubSupabase(tables: Record<string, Row[]>): TypedSupabaseClient {
  return {
    schema: () => ({
      from: (table: string) => ({
        select: () => ({
          eq: (_col: string, key: string) =>
            table === 'sans_tables'
              ? { maybeSingle: async () => ({ data: tables[key] ? { id: key } : null }) }
              : { order: async () => ({ data: tables[key] ?? [] }) },
        }),
      }),
    }),
  } as unknown as TypedSupabaseClient
}

const cite = (clause: string, pdf: number, printed: number) => ({ clause, page_pdf: pdf, page_printed: printed })
const T613 = cite('Table 6.13', 124, 120)
const T616 = cite('Table 6.16', 132, 128)
const T610 = cite('Table 6.10', 122, 118)

const LEGACY: Record<string, Row[]> = {
  TABLE_6_3_1: [
    { sort_key: 500, row_data: { depth_mm: 500, factor_direct_in_ground: 1.0, factor_single_way_duct: 1.0 } },
    { sort_key: 800, row_data: { depth_mm: 800, factor_direct_in_ground: 0.96, factor_single_way_duct: 0.98 } },
    { sort_key: 1500, row_data: { depth_mm: 1500, factor_direct_in_ground: 0.9, factor_single_way_duct: 0.94 } },
    { sort_key: 2000, row_data: { depth_mm: 2000, factor_direct_in_ground: 0.9, factor_single_way_duct: 0.93 } },
  ],
  TABLE_6_3_2: [
    { sort_key: 1.2, row_data: { resistivity_kmw: 1.2, factor_direct_in_ground: 1.0, factor_single_way_duct: 1.0 } },
  ],
  TABLE_6_3_3: [
    { sort_key: 2, row_data: { n_cables: 2, ground_touching: 0.81, duct_touching: 0.9 } },
    { sort_key: 3, row_data: { n_cables: 3, ground_touching: 0.7, duct_touching: 0.82 } },
  ],
  TABLE_6_3_4: [
    { sort_key: 25, row_data: { ambient_c: 25, factor_pvc_70c: 1.0, factor_xlpe_90c: 1.0 } },
    { sort_key: 30, row_data: { ambient_c: 30, factor_pvc_70c: 0.94, factor_xlpe_90c: 0.96 } },
  ],
  TABLE_6_3_5: [
    { sort_key: 30, row_data: { ambient_c: 30, factor_pvc_70c: 1.0, factor_xlpe_90c: 1.0 } },
    { sort_key: 35, row_data: { ambient_c: 35, factor_pvc_70c: 0.94, factor_xlpe_90c: 0.95 } },
  ],
}

const SANS: Record<string, Row[]> = {
  SANS_10142_1_2021_T6_13: [
    { sort_key: 2, row_data: { n_cables: 2, direct_touching: 0.81, pipes_touching: 0.9 }, citation: T613 },
    { sort_key: 3, row_data: { n_cables: 3, direct_touching: 0.7, pipes_touching: 0.82 }, citation: T613 },
  ],
  SANS_10142_1_2021_T6_16: [
    { sort_key: 0.5, row_data: { depth_m: 0.5, buried_direct: 1.0, in_pipes: 1.0 }, citation: T616 },
    { sort_key: 0.8, row_data: { depth_m: 0.8, buried_direct: 0.96, in_pipes: 0.98 }, citation: T616 },
    { sort_key: 1.5, row_data: { depth_m: 1.5, buried_direct: 0.9, in_pipes: 0.94 }, citation: T616 },
  ],
  SANS_10142_1_2021_T6_10: [
    { sort_key: 20, row_data: { ambient_c: 20, pvc_70c: 1.12 }, citation: T610 },
    { sort_key: 30, row_data: { ambient_c: 30, pvc_70c: 1.0 }, citation: T610 },
    { sort_key: 35, row_data: { ambient_c: 35, pvc_70c: 0.94 }, citation: T610 },
  ],
}

const BURIED = {
  depth_mm: 800, thermal_resistivity_kmw: 1.2, grouped_with: 3, ambient_c: 25,
  insulation: 'PVC' as const, installation_method: 'DIRECT_IN_GROUND',
}

describe('lookupDeratingFactors — citations read from the reference model', () => {
  it('cites a buried grouping factor to SANS 10142-1:2021 Table 6.13, printed p.120', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }), BURIED, { cite: true })
    expect(r.grouping).toBe(0.7)
    expect(r.sources.grouping.citation).toEqual({
      tableCode: 'SANS_10142_1_2021_T6_13', clause: 'Table 6.13', page_pdf: 124, page_printed: 120,
    })
  })

  it('cites a duct grouping factor to the pipes column of Table 6.13', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }),
      { ...BURIED, grouped_with: 2, installation_method: 'DUCT' }, { cite: true })
    expect(r.grouping).toBe(0.9)
    expect(r.sources.grouping.citation?.clause).toBe('Table 6.13')
  })

  it('cites depth in mm to Table 6.16 in metres (printed p.128)', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }), BURIED, { cite: true })
    expect(r.depth).toBe(0.96)
    expect(r.sources.depth.citation?.page_printed).toBe(128)
  })

  it('beyond the deepest SANS row (2.0 m) keeps the legacy factor, uncited', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }), { ...BURIED, depth_mm: 1800 }, { cite: true })
    expect(r.depth).toBe(0.9)
    expect(r.sources.depth.tableCode).toBe('TABLE_6_3_1')
    expect(r.sources.depth.citation).toBeNull()
  })

  it('a caller who cannot read the SANS tables gets the same numbers, uncited', async () => {
    const withSans = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }), BURIED, { cite: true })
    const without = await lookupDeratingFactors(stubSupabase(LEGACY), BURIED, { cite: true })
    expect([without.depth, without.thermal, without.grouping, without.temperature])
      .toEqual([withSans.depth, withSans.thermal, withSans.grouping, withSans.temperature])
    expect(without.sources.grouping.citation).toBeNull()
  })

  it('a SANS cell that differs is flagged and NOT applied', async () => {
    const tampered = { ...SANS, SANS_10142_1_2021_T6_13: SANS.SANS_10142_1_2021_T6_13.map((r) =>
      r.sort_key === 3 ? { ...r, row_data: { ...r.row_data, direct_touching: 0.75 } } : r) }
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...tampered }), BURIED, { cite: true })
    expect(r.grouping).toBe(0.7)
    expect(r.sources.grouping.citation).toBeNull()
    expect(r.sources.grouping.sansDisagrees).toBe(true)
  })

  it('20 °C air: SANS would pick its 20 °C uprating row, the calculator keeps 1.0 and cites nothing', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }),
      { ...BURIED, installation_method: 'TRAY', ambient_c: 20, grouped_with: 1 }, { cite: true })
    expect(r.temperature).toBe(1.0)
    expect(r.sources.temperature.citation).toBeNull()
  })

  it('35 °C air on PVC is cited to Table 6.10', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }),
      { ...BURIED, installation_method: 'TRAY', ambient_c: 35, grouped_with: 1 }, { cite: true })
    expect(r.temperature).toBe(0.94)
    expect(r.sources.temperature.citation?.page_printed).toBe(118)
  })

  it('XLPE temperature has no SANS column, so it stays uncited', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }),
      { ...BURIED, insulation: 'XLPE', installation_method: 'TRAY', ambient_c: 35, grouped_with: 1 }, { cite: true })
    expect(r.temperature).toBe(0.95)
    expect(r.sources.temperature.citation).toBeNull()
  })

  it('without cite: true it reads no SANS table and returns no citation', async () => {
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...SANS }), BURIED)
    expect(r.grouping).toBe(0.7)
    expect(r.sources.grouping.citation).toBeNull()
  })

  it('a SANS row without a citation is never presented as cited', async () => {
    const uncited = { ...SANS, SANS_10142_1_2021_T6_13: SANS.SANS_10142_1_2021_T6_13.map((r) => ({ ...r, citation: null })) }
    const r = await lookupDeratingFactors(stubSupabase({ ...LEGACY, ...uncited }), BURIED, { cite: true })
    expect(r.sources.grouping.citation).toBeNull()
  })
})
