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
 * Apply derating factors. Pulls factors from the SANS 1507 LV derating
 * tables — 6.3.1 (depth), 6.3.2 (soil thermal resistivity), 6.3.6
 * (grouping) and 6.3.4 (ground temperature) — based on the installation
 * parameters.
 *
 * If a factor table lookup misses a value, the nearest-conservative
 * (lower) factor is used so the calculation errs on the safe side.
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
  // SANS 1507 LV derating tables 6.3.1–6.3.6 (migration 00057, source-workbook
  // shape). Each tabulates a direct-in-ground and an in-duct factor; the
  // auto-calc takes the direct-in-ground / touching / ground-temperature
  // values as the conservative default. Temperature (6.3.4) carries separate
  // columns for PVC 70 °C and XLPE 90 °C conductors. Grouping reads 6.3.6
  // (per-count, includes n = 1) rather than the 6.3.3 axial-spacing matrix,
  // since the caller supplies only a cable count, not a spacing.
  const tempFactorKey = args.insulation === 'XLPE' ? 'factor_xlpe_90c' : 'factor_pvc_70c'
  const groupingFactorKey =
    args.grouping_arrangement === 'SPACING_D' ? 'factor_clearance_d' : 'factor_touching'

  const [d, th, gr, te] = await Promise.all([
    lookupFactor(supabase, 'TABLE_6_3_1', 'depth_mm',        args.depth_mm,                'factor_direct_in_ground'),
    lookupFactor(supabase, 'TABLE_6_3_2', 'resistivity_kmw', args.thermal_resistivity_kmw, 'factor_direct_in_ground'),
    lookupFactor(supabase, 'TABLE_6_3_6', 'n_cables',        args.grouped_with,            groupingFactorKey),
    lookupFactor(supabase, 'TABLE_6_3_4', 'ambient_c',       args.ambient_c,               tempFactorKey),
  ])
  return { depth: d, thermal: th, grouping: gr, temperature: te }
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

  // Find the nearest sort_key ≤ value. If value is below the lowest
  // tabulated key, use the lowest. If value is above the highest, use the
  // highest (conservative — derating tightens as conditions worsen).
  let chosen = list[0]!
  for (const r of list) {
    if (r.sort_key <= value) chosen = r
    else break
  }
  const f = chosen.row_data[factorKey]
  return typeof f === 'number' ? f : null
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
