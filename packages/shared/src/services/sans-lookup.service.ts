/**
 * SANS reference table lookups — feeds the cable schedule grid.
 *
 * Strategy: the bundled cable_schedule.sans_tables + sans_rows are
 * world-readable so any authenticated client can hit them. For per-
 * project overrides (cable_schedule.sans_overrides), the policy is org-
 * scoped — caller must be a member of the org that owns the project.
 *
 * Lookups fall back from override → bundled when a project_id is given;
 * otherwise straight to bundled. This mirrors §16.11 of the spec.
 */

import type { TypedSupabaseClient } from '@esite/db'

/** Standardised columns the schedule grid expects per row from Table 6.4-like rating tables. */
export interface CablePropertyLookup {
  size_mm2: number
  rating_direct_buried: number | null
  rating_in_duct: number | null
  rating_in_air: number | null
  dc_resistance: number | null
  ac_resistance: number | null
  reactance: number | null
  short_circuit_1s: number | null
}

interface SansTableShape {
  id: string
  code: string
  columns: Array<{ key: string }>
}

interface SansRowShape {
  table_id: string
  sort_key: number
  row_data: Record<string, unknown>
}

interface SansOverrideShape {
  table_code: string
  columns: Array<{ key: string }>
  rows: Record<string, unknown>[]
}

/**
 * Map (conductor, insulation, cores) to the canonical bundled table code.
 * Returns null when no bundled table exists for the combo — the caller
 * should fall back to a sensible default or surface "missing rating".
 */
export function tableCodeFor(
  conductor: 'CU' | 'AL',
  insulation: 'PVC' | 'XLPE' | 'PILC',
  cores: '3' | '3+E' | '4',
): string | null {
  // Bundled LV multi-core tables, seeded from the firm's verified FACTS AND
  // FIGURES workbook in migration 00056. `cores` is not a discriminator —
  // each table covers both 3- and 4-core constructions.
  void cores
  if (insulation === 'XLPE' && conductor === 'CU') return 'TABLE_6_4'
  if (insulation === 'XLPE' && conductor === 'AL') return 'TABLE_6_5'
  if (insulation === 'PVC'  && conductor === 'CU') return 'TABLE_6_2'
  if (insulation === 'PVC'  && conductor === 'AL') return 'TABLE_6_3'
  // PILC (MV paper, Table 4.2 / 5.2) and single-core tables (6.6 / 6.7) are
  // viewable in the SANS reference library but not auto-filled here — there
  // is no LV multi-core lookup mapping for them.
  return null
}

/**
 * Look up a cable's electrical + thermal properties for a given size, with
 * optional per-project override.
 *
 * Order:
 *   1. If projectId is given and a sans_overrides row exists for the
 *      mapped table_code, prefer that.
 *   2. Otherwise read cable_schedule.sans_rows for the bundled table.
 *   3. If neither has a row for the requested size_mm2, return null.
 */
export async function lookupCableProperties(
  supabase: TypedSupabaseClient,
  args: {
    conductor: 'CU' | 'AL'
    insulation: 'PVC' | 'XLPE' | 'PILC'
    cores: '3' | '3+E' | '4'
    size_mm2: number
    projectId?: string
  },
): Promise<CablePropertyLookup | null> {
  const code = tableCodeFor(args.conductor, args.insulation, args.cores)
  if (!code) return null

  // 1. Override lookup
  if (args.projectId) {
    const { data: ov } = await (supabase as any)
      .schema('cable_schedule')
      .from('sans_overrides')
      .select('table_code, columns, rows')
      .eq('project_id', args.projectId)
      .eq('table_code', code)
      .maybeSingle()
    const ovRow = (ov as SansOverrideShape | null)?.rows.find(
      (r) => Number(r.size_mm2) === args.size_mm2,
    )
    if (ovRow) return normalise(ovRow)
  }

  // 2. Bundled lookup
  const { data: table } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_tables')
    .select('id')
    .eq('code', code)
    .maybeSingle()
  if (!table) return null
  const t = table as { id: string }

  const { data: rows } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_rows')
    .select('row_data')
    .eq('table_id', t.id)
    .eq('sort_key', args.size_mm2)
    .maybeSingle()
  const row = (rows as { row_data?: Record<string, unknown> } | null)?.row_data
  return row ? normalise(row) : null
}

/**
 * Bulk variant — fetch the full table at once. Used by the schedule grid
 * to populate the size dropdown + pre-fill cell defaults without a
 * round-trip per row.
 */
export async function loadCableTable(
  supabase: TypedSupabaseClient,
  args: {
    conductor: 'CU' | 'AL'
    insulation: 'PVC' | 'XLPE' | 'PILC'
    cores: '3' | '3+E' | '4'
    projectId?: string
  },
): Promise<CablePropertyLookup[]> {
  const code = tableCodeFor(args.conductor, args.insulation, args.cores)
  if (!code) return []

  if (args.projectId) {
    const { data: ov } = await (supabase as any)
      .schema('cable_schedule')
      .from('sans_overrides')
      .select('rows')
      .eq('project_id', args.projectId)
      .eq('table_code', code)
      .maybeSingle()
    const rows = (ov as { rows?: Record<string, unknown>[] } | null)?.rows
    if (rows && rows.length > 0) return rows.map(normalise)
  }

  const { data: table } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_tables')
    .select('id')
    .eq('code', code)
    .maybeSingle()
  if (!table) return []
  const t = table as { id: string }

  const { data: rows } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_rows')
    .select('row_data, sort_key')
    .eq('table_id', t.id)
    .order('sort_key', { ascending: true })
  const list = ((rows ?? []) as Array<{ row_data: Record<string, unknown> }>)
  return list.map((r) => normalise(r.row_data))
}

/**
 * Resolve which SANS 1507 derating tables apply for a given installation
 * method. Burial depth (6.3.1) and soil-thermal resistivity (6.3.2) only
 * derate a cable that is actually in the ground or a buried duct — a cable
 * in air (on a ladder, tray or cleats) has no burial depth and no soil
 * around it, so both factors are 1.0 and the ambient correction reads the
 * air table (6.3.5) instead of the ground table (6.3.4). DUCT additionally
 * selects the single-way-duct soil columns rather than the direct-in-ground
 * columns.
 *
 * Recognised methods: DIRECT_IN_GROUND, DUCT, LADDER, TRAY, CLIPPED.
 * Anything else (including null) is treated as in-air — consistent with the
 * base-rating selection, which also falls through to the in-air rating for
 * non-ground/non-duct methods.
 */
export function deratingBasis(method: string | null): {
  inAir: boolean
  soilFactorKey: 'factor_direct_in_ground' | 'factor_single_way_duct'
  temperatureTable: 'TABLE_6_3_4' | 'TABLE_6_3_5'
} {
  const inDuct = method === 'DUCT'
  const inGround = method === 'DIRECT_IN_GROUND'
  const inAir = !inDuct && !inGround
  return {
    inAir,
    soilFactorKey: inDuct ? 'factor_single_way_duct' : 'factor_direct_in_ground',
    temperatureTable: inAir ? 'TABLE_6_3_5' : 'TABLE_6_3_4',
  }
}

/**
 * Apply derating factors from the LV reference tables, branching on the
 * installation method (see deratingBasis): 6.3.1 (depth) and 6.3.2 (soil
 * thermal) for in-ground / duct cables, grouping from 6.3.3 (buried/duct)
 * or 6.3.6 (in air), and the ground (6.3.4) or air (6.3.5) ambient table.
 * In-air cables skip depth and soil — both are returned as 1.0.
 *
 * Values between tabulated rows resolve to the next row up (see
 * selectConservativeSortKey) so the calculation errs on the safe side.
 */
export async function lookupDeratingFactors(
  supabase: TypedSupabaseClient,
  args: {
    depth_mm: number
    thermal_resistivity_kmw: number
    grouped_with: number
    ambient_c: number
    insulation: 'PVC' | 'XLPE' | 'PILC'
    /**
     * Installation method — selects whether the burial-depth / soil-thermal
     * chain applies (in-ground / duct) or is bypassed (in air), and which
     * ambient table is read. See deratingBasis. Null → in-air.
     */
    installation_method: string | null
    /**
     * Cable layout in the trench / duct group.
     *   TOUCHING  → T6.3.6 `factor_touching` (conservative, hardest derate)
     *   SPACING_D → T6.3.6 `factor_clearance_d` (1× cable-diameter clearance)
     * Defaults to TOUCHING for back-compat with callers from before
     * migration 00064.
     */
    grouping_arrangement?: 'TOUCHING' | 'SPACING_D'
  },
): Promise<{
  depth: number | null
  thermal: number | null
  grouping: number | null
  temperature: number | null
}> {
  // LV derating tables (migration 00057, Aberdare F&F §6.3 shape, aligned
  // to SANS 10142-1 Tables 6.10–6.16 where SANS publishes a value). The
  // depth (6.3.1) and soil-thermal (6.3.2) tables each tabulate a
  // direct-in-ground and a single-way-duct factor; deratingBasis picks the
  // column for the installation method and, for in-air cables, bypasses both
  // (factor 1.0 — no burial depth, no soil). Temperature reads the ground
  // (6.3.4) or air (6.3.5) table — both carry separate PVC 70 °C / XLPE 90 °C
  // columns.
  //
  // Grouping depends on where the group is: in air it reads 6.3.6
  // (touching / one-diameter clearance). Buried or in ducts it reads the
  // 6.3.3 matrix (= SANS 10142-1 Table 6.13), which is much harsher — six
  // touching buried cables derate to 0.55, not 6.3.6's in-air 0.80. Both
  // buried arrangements use the touching column: SANS 6.13's first spaced
  // column is 150 mm clearance, more than one cable diameter, so touching
  // is the applicable conservative choice for SPACING_D too.
  const tempFactorKey = args.insulation === 'XLPE' ? 'factor_xlpe_90c' : 'factor_pvc_70c'
  const airGroupingKey =
    args.grouping_arrangement === 'SPACING_D' ? 'factor_clearance_d' : 'factor_touching'
  const basis = deratingBasis(args.installation_method)
  const buriedGroupingKey =
    args.installation_method === 'DUCT' ? 'duct_touching' : 'ground_touching'

  const [d, th, gr, te] = await Promise.all([
    basis.inAir
      ? Promise.resolve(1)
      : lookupFactor(supabase, 'TABLE_6_3_1', 'depth_mm',        args.depth_mm,                basis.soilFactorKey),
    basis.inAir
      ? Promise.resolve(1)
      : lookupFactor(supabase, 'TABLE_6_3_2', 'resistivity_kmw', args.thermal_resistivity_kmw, basis.soilFactorKey),
    args.grouped_with <= 1
      ? Promise.resolve(1)
      : basis.inAir
        ? lookupFactor(supabase, 'TABLE_6_3_6', 'n_cables', args.grouped_with, airGroupingKey)
        : lookupFactor(supabase, 'TABLE_6_3_3', 'n_cables', args.grouped_with, buriedGroupingKey),
    lookupFactor(supabase, basis.temperatureTable, 'ambient_c', args.ambient_c, tempFactorKey),
  ])
  return { depth: d, thermal: th, grouping: gr, temperature: te }
}

/**
 * Conservative row selection for a derating axis. Every axis in these
 * tables worsens as the key rises — deeper burial, hotter ambient, more
 * resistive soil, more cables in the group — so a value between tabulated
 * rows takes the factor from the next row UP (never the friendlier row
 * below, which the pre-2026-07 floor lookup used). Below the first row →
 * first row; beyond the last row → last row, the strongest derate the
 * table offers.
 */
export function selectConservativeSortKey(
  ascendingKeys: readonly number[],
  value: number,
): number | null {
  if (ascendingKeys.length === 0) return null
  for (const k of ascendingKeys) {
    if (k >= value) return k
  }
  return ascendingKeys[ascendingKeys.length - 1]!
}

async function lookupFactor(
  supabase: TypedSupabaseClient,
  code: string,
  key: string,
  value: number,
  factorKey = 'factor',
): Promise<number | null> {
  const { data: t } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_tables')
    .select('id')
    .eq('code', code)
    .maybeSingle()
  if (!t) return null
  const { data: rows } = await (supabase as any)
    .schema('cable_schedule')
    .from('sans_rows')
    .select('row_data, sort_key')
    .eq('table_id', (t as { id: string }).id)
    .order('sort_key', { ascending: true })
  const list = ((rows ?? []) as Array<{ sort_key: number; row_data: Record<string, unknown> }>)
  if (list.length === 0) return null

  const chosenKey = selectConservativeSortKey(list.map((r) => r.sort_key), value)
  const startIdx = list.findIndex((r) => r.sort_key === chosenKey)
  if (startIdx === -1) return null
  // The chosen row may not carry this column — e.g. the PVC-only uprating
  // rows below the 25 °C ground reference omit factor_xlpe_90c. Rows further
  // up the axis are always at least as conservative, so scan upward to the
  // first row that has the value (an 18 °C XLPE lookup falls through 20 °C
  // to the 25 °C reference row's 1.0). Past the last populated row — e.g.
  // PVC-only air-temperature rows above 45 °C — the answer stays an honest
  // null: no published factor exists.
  for (let i = startIdx; i < list.length; i++) {
    const f = list[i]!.row_data[factorKey]
    if (typeof f === 'number') return f
  }
  return null
}

function normalise(r: Record<string, unknown>): CablePropertyLookup {
  // Bootstrap tables (migration 00056) carry the source-workbook column
  // names; legacy seeds and project overrides may use the older normalised
  // names. Accept both. For XLPE the 90 °C rating column is the rated value
  // (XLPE conductors run at 90 °C); PVC / AL tables have a single rating set.
  const impedance = num(r.impedance_ohm_per_km)
  return {
    size_mm2:               num(r.size_mm2) ?? 0,
    rating_direct_buried:   num(r.current_rating_ground_90c_a) ?? num(r.current_rating_ground_a) ?? num(r.rating_direct_buried),
    rating_in_duct:         num(r.current_rating_duct_90c_a)   ?? num(r.current_rating_duct_a)   ?? num(r.rating_in_duct),
    rating_in_air:          num(r.current_rating_air_90c_a)    ?? num(r.current_rating_air_a)    ?? num(r.rating_in_air),
    dc_resistance:          num(r.dc_resistance) ?? impedance,
    ac_resistance:          num(r.ac_resistance) ?? impedance,
    reactance:              num(r.reactance),
    short_circuit_1s:       num(r.short_circuit_1s) ?? num(r.short_circuit_1s_ka),
  }
}

function num(v: unknown): number | null {
  if (v == null) return null
  const n = typeof v === 'number' ? v : Number(v)
  return Number.isFinite(n) ? n : null
}
