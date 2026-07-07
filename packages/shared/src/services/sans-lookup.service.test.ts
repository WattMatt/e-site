import { describe, expect, it } from 'vitest'
import {
  deratingBasis,
  lookupDeratingFactors,
  selectConservativeSortKey,
} from './sans-lookup.service'
import type { TypedSupabaseClient } from '@esite/db'

/**
 * Minimal stand-in for the two-query chain lookupFactor runs:
 * sans_tables by code → sans_rows by table_id, ordered by sort_key.
 * Table code doubles as its id.
 */
function stubSupabase(
  tables: Record<string, Array<{ sort_key: number; row_data: Record<string, unknown> }>>,
): TypedSupabaseClient {
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

const FACTOR_TABLES = {
  TABLE_6_3_1: [
    { sort_key: 500, row_data: { depth_mm: 500, factor_direct_in_ground: 1.0, factor_single_way_duct: 1.0 } },
    { sort_key: 600, row_data: { depth_mm: 600, factor_direct_in_ground: 0.98, factor_single_way_duct: 0.99 } },
    { sort_key: 800, row_data: { depth_mm: 800, factor_direct_in_ground: 0.96, factor_single_way_duct: 0.98 } },
  ],
  TABLE_6_3_2: [
    { sort_key: 1.0, row_data: { resistivity_kmw: 1.0, factor_direct_in_ground: 1.06, factor_single_way_duct: 1.02 } },
    { sort_key: 1.2, row_data: { resistivity_kmw: 1.2, factor_direct_in_ground: 1.0, factor_single_way_duct: 1.0 } },
    { sort_key: 1.5, row_data: { resistivity_kmw: 1.5, factor_direct_in_ground: 0.93, factor_single_way_duct: 0.96 } },
  ],
  TABLE_6_3_3: [
    { sort_key: 2, row_data: { n_cables: 2, ground_touching: 0.81, duct_touching: 0.9 } },
    { sort_key: 3, row_data: { n_cables: 3, ground_touching: 0.7, duct_touching: 0.82 } },
    { sort_key: 4, row_data: { n_cables: 4, ground_touching: 0.63, duct_touching: 0.78 } },
    { sort_key: 6, row_data: { n_cables: 6, ground_touching: 0.55, duct_touching: 0.72 } },
  ],
  TABLE_6_3_4: [
    // 10–20 °C are SANS PVC-only uprating rows — factor_xlpe_90c deliberately absent
    { sort_key: 10, row_data: { ambient_c: 10, factor_pvc_70c: 1.15 } },
    { sort_key: 15, row_data: { ambient_c: 15, factor_pvc_70c: 1.11 } },
    { sort_key: 20, row_data: { ambient_c: 20, factor_pvc_70c: 1.05 } },
    { sort_key: 25, row_data: { ambient_c: 25, factor_pvc_70c: 1.0, factor_xlpe_90c: 1.0 } },
    { sort_key: 30, row_data: { ambient_c: 30, factor_pvc_70c: 0.94, factor_xlpe_90c: 0.96 } },
    { sort_key: 35, row_data: { ambient_c: 35, factor_pvc_70c: 0.88, factor_xlpe_90c: 0.92 } },
  ],
  TABLE_6_3_5: [
    { sort_key: 30, row_data: { ambient_c: 30, factor_pvc_70c: 1.0, factor_xlpe_90c: 1.0 } },
    { sort_key: 35, row_data: { ambient_c: 35, factor_pvc_70c: 0.94, factor_xlpe_90c: 0.95 } },
    { sort_key: 40, row_data: { ambient_c: 40, factor_pvc_70c: 0.87, factor_xlpe_90c: 0.89 } },
    { sort_key: 50, row_data: { ambient_c: 50, factor_pvc_70c: 0.71 } },
  ],
  TABLE_6_3_6: [
    { sort_key: 1, row_data: { n_cables: 1, factor_touching: 1.0, factor_clearance_d: 1.0 } },
    { sort_key: 2, row_data: { n_cables: 2, factor_touching: 0.9, factor_clearance_d: 0.95 } },
    { sort_key: 3, row_data: { n_cables: 3, factor_touching: 0.84, factor_clearance_d: 0.9 } },
    { sort_key: 6, row_data: { n_cables: 6, factor_touching: 0.8, factor_clearance_d: 0.88 } },
    { sort_key: 9, row_data: { n_cables: 9, factor_touching: 0.75, factor_clearance_d: 0.85 } },
  ],
}

describe('selectConservativeSortKey', () => {
  it('returns the exact key when tabulated', () => {
    expect(selectConservativeSortKey([2, 3, 4, 6], 3)).toBe(3)
  })

  it('rounds UP between rows — never the friendlier row below', () => {
    expect(selectConservativeSortKey([2, 3, 6, 9], 4)).toBe(6)
    expect(selectConservativeSortKey([30, 35, 40, 45], 34)).toBe(35)
  })

  it('clamps to the last (harshest) row above range and the first below', () => {
    expect(selectConservativeSortKey([2, 3, 6], 12)).toBe(6)
    expect(selectConservativeSortKey([500, 600, 800], 300)).toBe(500)
  })

  it('returns null for an empty table', () => {
    expect(selectConservativeSortKey([], 5)).toBeNull()
  })
})

describe('lookupDeratingFactors', () => {
  const supabase = stubSupabase(FACTOR_TABLES)

  it('buried grouped cables read the 6.3.3 buried matrix, not the in-air table', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 4,
      ambient_c: 25,
      insulation: 'PVC',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f.grouping).toBe(0.63) // SANS 6.13 touching n=4 — not 6.3.6's 0.84
    expect(f.depth).toBe(1.0)
    expect(f.thermal).toBe(1.0)
    expect(f.temperature).toBe(1.0)
  })

  it('a buried group count between rows takes the harsher row (5 → n=6)', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 5,
      ambient_c: 25,
      insulation: 'PVC',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f.grouping).toBe(0.55)
  })

  it('duct groups use the duct column of 6.3.3', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 3,
      ambient_c: 25,
      insulation: 'PVC',
      installation_method: 'DUCT',
    })
    expect(f.grouping).toBe(0.82)
  })

  it('in-air groups still read 6.3.6, conservative between rows (4 → n=6)', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 0,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 4,
      ambient_c: 30,
      insulation: 'PVC',
      installation_method: 'LADDER',
    })
    expect(f.grouping).toBe(0.8)
    expect(f.depth).toBe(1)
    expect(f.thermal).toBe(1)
  })

  it('a single cable never takes a grouping derate', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 25,
      insulation: 'PVC',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f.grouping).toBe(1)
  })

  it('ambient between rows rounds up: 34 °C in air reads the 35 °C factor', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 0,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 34,
      insulation: 'PVC',
      installation_method: 'TRAY',
    })
    expect(f.temperature).toBe(0.94)
  })

  it('hot sites keep derating past the old 45 °C clamp (50 °C PVC → 0.71)', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 0,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 50,
      insulation: 'PVC',
      installation_method: 'TRAY',
    })
    expect(f.temperature).toBe(0.71)
  })

  it('cold ground under an XLPE cable falls through PVC-only rows to the 25 °C reference 1.0', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 18,
      insulation: 'XLPE',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f.temperature).toBe(1.0) // 18 → 20 °C row (PVC-only) → falls up to 25 °C
  })

  it('cold ground under a PVC cable takes the published uprating row', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 18,
      insulation: 'PVC',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f.temperature).toBe(1.05)
  })

  it('hot air above the last XLPE row stays an honest null (no published factor)', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 0,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 50,
      insulation: 'XLPE',
      installation_method: 'TRAY',
    })
    expect(f.temperature).toBeNull() // fixture's 50 °C air row is PVC-only
  })

  it('reference conditions resolve to exactly 1.0 (buried, 1.2 K·m/W, 25 °C)', async () => {
    const f = await lookupDeratingFactors(supabase, {
      depth_mm: 500,
      thermal_resistivity_kmw: 1.2,
      grouped_with: 1,
      ambient_c: 25,
      insulation: 'XLPE',
      installation_method: 'DIRECT_IN_GROUND',
    })
    expect(f).toEqual({ depth: 1.0, thermal: 1.0, grouping: 1, temperature: 1.0 })
  })
})

describe('deratingBasis', () => {
  it('DIRECT_IN_GROUND uses the direct-in-ground soil columns and the ground temperature table', () => {
    expect(deratingBasis('DIRECT_IN_GROUND')).toEqual({
      inAir: false,
      soilFactorKey: 'factor_direct_in_ground',
      temperatureTable: 'TABLE_6_3_4',
    })
  })

  it('DUCT uses the single-way-duct soil columns and the ground temperature table', () => {
    expect(deratingBasis('DUCT')).toEqual({
      inAir: false,
      soilFactorKey: 'factor_single_way_duct',
      temperatureTable: 'TABLE_6_3_4',
    })
  })

  it.each(['LADDER', 'TRAY', 'CLIPPED'])(
    '%s is in air — soil/depth bypassed, air temperature table',
    (method) => {
      expect(deratingBasis(method)).toEqual({
        inAir: true,
        soilFactorKey: 'factor_direct_in_ground',
        temperatureTable: 'TABLE_6_3_5',
      })
    },
  )

  it('null defaults to in air (matches the in-air base-rating fallthrough)', () => {
    expect(deratingBasis(null)).toEqual({
      inAir: true,
      soilFactorKey: 'factor_direct_in_ground',
      temperatureTable: 'TABLE_6_3_5',
    })
  })

  it('an unrecognised method is treated as in air, never as buried', () => {
    const basis = deratingBasis('SOMETHING_NEW')
    expect(basis.inAir).toBe(true)
    expect(basis.temperatureTable).toBe('TABLE_6_3_5')
  })
})
