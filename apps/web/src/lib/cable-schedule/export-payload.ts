/**
 * Single data loader shared by every cable-schedule exporter (Excel,
 * CSV, PDF, ZIP). One round-trip to the cable_schedule schema so the
 * four file formats render the same snapshot.
 *
 * Returns enriched cables with FROM/TO labels and VD% pre-computed so
 * the format-specific renderers stay dumb.
 */

import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
} from '@esite/shared'
import type { SupabaseClient } from '@supabase/supabase-js'

import { selectWithFallbackOn42703 } from './postgrest-fallback'

export interface ExportPayload {
  /**
   * True when this payload has been passed through `redactPayloadCost`
   * (client_viewer exports). Renderers MUST short-circuit their cost
   * sections when this is set — emptying `costLines` alone is not enough,
   * because the renderers derive the BoM (sizes × lengths × terminations)
   * from `cables` and would otherwise emit a fully-itemised bill with
   * R0 rates. Defaults to `false` in `getRevisionExportPayload`.
   */
  costRedacted?: boolean
  project: {
    id: string
    name: string
    organisation_id: string
  }
  revision: {
    id: string
    code: string
    description: string | null
    status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED'
    issued_at: string | null
    issued_by_name: string | null
    fault_level_ka: number | null
    change_notes: string | null
    created_at: string
    /** VAT % per migration 00060. Null when migration not yet applied; renderers default to 15. */
    vat_pct: number | null
  }
  /**
   * Cable-schedule feed roots — `utility` / `pv` / `standby` only. RMU and
   * mini-sub source types migrated to `structure.nodes` in the unified-node
   * model (migration 00077); they are now `nodes` rows, not sources.
   */
  sources: Array<{
    id: string
    code: string
    type: string
    rating_kva: number | null
    voltage_v: number | null
    notes: string | null
  }>
  /**
   * Project-level structure registry — every board, RMU, mini-sub and
   * generator on the project. Replaces the old revision-scoped
   * `cable_schedule.boards`. NOT revision-scoped: nodes persist for the
   * life of the project and are referenced (not copied) by each revision.
   */
  nodes: Array<{
    id: string
    kind: 'tenant_db' | 'main_board' | 'common_area_board' | 'rmu' | 'mini_sub' | 'generator'
    code: string
    name: string | null
    coc_required: boolean
    status: 'active' | 'decommissioned'
    shop_number: string | null
    shop_name: string | null
    shop_area_m2: number | null
    breaker_rating_a: number | null
    pole_config: string | null
    section: string | null
    rating_kva: number | null
    voltage_v: number | null
    notes: string | null
  }>
  supplies: Array<{
    id: string
    /** Feed origin when it's a cable-schedule source (utility/pv/standby). XOR with from_node_id. */
    from_source_id: string | null
    /** Feed origin when it's a structure node. XOR with from_source_id. */
    from_node_id: string | null
    /** Feed destination — always a structure node. */
    to_node_id: string | null
    voltage_v: number
    design_load_a: number | null
    section: string | null
  }>
  cables: EnrichedCable[]
  /**
   * Runs — the canonical SANS "one row per supply / circuit" projection.
   * Each run aggregates 1..N parallel cables under their shared logical
   * feed. This is what the schedule grid + Excel/PDF/CSV exporters render
   * one row per. The `cables` array on each run is kept for drill-down
   * (per-strand measured length, terminations, individual tags).
   */
  runs: EnrichedRun[]
  cableTags: Array<{
    id: string
    cable_id: string
    end_position: 'FROM' | 'TO'
    tag_text: string
    printed: boolean
    printed_at: string | null
  }>
  costLines: Array<{
    id: string
    size_mm2: number
    conductor: 'CU' | 'AL'
    supply_rate_per_m: number
    install_rate_per_m: number
    termination_rate_each: number
  }>
  changeLog: Array<{
    id: string
    entity_type: string
    entity_id: string
    field_name: string | null
    old_value: unknown
    new_value: unknown
    reason: string | null
    changed_by_name: string | null
    changed_at: string
  }>
}

export interface EnrichedCable {
  id: string
  supply_id: string
  cable_no: number
  size_mm2: number
  cores: '3' | '3+E' | '4'
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
  standard: string | null
  ohm_per_km: number | null
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  derated_current_rating_a: number | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  /** T6.3.6 layout — TOUCHING (default) uses factor_touching; SPACING_D uses factor_clearance_d. */
  grouping_arrangement: 'TOUCHING' | 'SPACING_D'
  ambient_temp_c: number
  tag_override: string | null
  manual_override: boolean
  notes: string | null

  // Joined / derived ↓
  from_label: string
  to_label: string
  voltage_v: number | null
  load_a: number | null
  /** as-built VD% for this cable's supply (worst conductor in the supply) */
  vd_pct: number
  /** cumulative VD% from the source to this supply's destination board */
  cumulative_vd_pct: number
  /** computed tag (override > auto from supply route + cable_no) */
  cable_tag: string
}

/**
 * One row per supply (canonical SANS shape). Aggregates the supply's
 * parallel cables under their shared logical feed.
 *
 * Shared properties (size_mm2, cores, conductor, insulation, install_method,
 * depth_mm, grouped_with, ohm_per_km) are taken from the supply's FIRST
 * cable. In a valid design these are identical across parallels; if they
 * diverge, `mixed_properties.fields` lists which fields differ — the grid
 * surfaces a "⚠ Mixed" badge with a one-click "Normalise to first" fix.
 */
export interface EnrichedRun {
  supply_id: string
  section: string | null
  from_label: string
  to_label: string

  voltage_v: number
  load_a: number | null
  /** Number of physical cables on this supply (parallel_count). */
  parallel_count: number

  // Shared cable properties (taken from cables[0]; see mixed_properties)
  size_mm2: number
  cores: '3' | '3+E' | '4'
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  ohm_per_km: number | null

  // Length aggregation across parallel cables
  /** Active length for the supply, in metres. Worst of the strands. Null if any strand is unmeasured and the design didn't fall back. */
  active_length_m: number | null
  /** Worst length_status across the supply's strands. UNMEASURED if any. */
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'

  // Derived
  /** Sum of strands' derated ratings (combined capacity), A. Null if any unknown. */
  combined_capacity_a: number | null
  /** True when combined capacity is below design load. */
  under_rated: boolean
  /** Voltage drop % for the run (same for all strands — supply-level). */
  vd_pct: number
  cumulative_vd_pct: number

  /**
   * Divergence flag — empty list means all parallels share identical
   * shared properties (the normal case). Populated only when the schema's
   * permissiveness has let strands drift apart.
   */
  mixed_properties: { fields: Array<keyof Pick<EnrichedRun, 'size_mm2' | 'cores' | 'conductor' | 'insulation' | 'installation_method' | 'depth_mm' | 'grouped_with' | 'ohm_per_km'>> }

  /** Strand-level detail for drill-down. Ordered by cable_no asc. */
  cables: EnrichedCable[]
}

interface RawCable extends CableForCalc {
  cores: '3' | '3+E' | '4'
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
  standard: string | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  grouping_arrangement: 'TOUCHING' | 'SPACING_D' | null
  ambient_temp_c: number
  derated_current_rating_a: number | null
  tag_override: string | null
  manual_override: boolean
  notes: string | null
}

/**
 * Pulls every cable_schedule.* table needed by the exporters. Caller
 * provides the supabase client with the user's session (RLS does the
 * project-access gate).
 */
export async function getRevisionExportPayload(
  supabase: SupabaseClient,
  projectId: string,
  revisionId: string,
): Promise<ExportPayload | null> {
  const client = supabase as never as {
    schema: (s: string) => {
      from: (t: string) => any
    }
    from: (t: string) => any
  }

  const [
    { data: projectRow },
    { data: revisionRow },
    { data: sourcesData },
    { data: nodesData },
    { data: suppliesData },
    { data: cablesData },
    { data: tagsData },
    { data: costData },
    { data: changeLogData },
  ] = await Promise.all([
    (supabase as any)
      .schema('projects')
      .from('projects')
      .select('id, name, organisation_id')
      .eq('id', projectId)
      .single(),
    // vat_pct landed on revisions in migration 00060. SELECT is tolerant —
    // if the column isn't applied yet PostgREST returns 42703 (undefined
    // column) and the inner retry drops back to the pre-00060 projection.
    // Same shape as the cost_lines.conductor tolerance below + the in-app
    // cost/page.tsx pattern (c2cfeb2). Mapper defaults vat_pct to null.
    // The previous version of this query embedded `issued_by_profile:profiles!issued_by(full_name)`
    // but PostgREST can't resolve that cross-schema FK (revisions lives in
    // cable_schedule, profiles lives in public) and returned PGRST200 every
    // time — silently masked by the route's <a download> failure shape. Now
    // we read `issued_by` as a UUID and resolve names via a separate
    // public.profiles batch query below.
    selectWithFallbackOn42703(
      () => (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select(
          'id, code, description, status, issued_at, fault_level_ka, change_notes, created_at, vat_pct, issued_by',
        )
        .eq('id', revisionId)
        .eq('project_id', projectId)
        .single(),
      () => (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select(
          'id, code, description, status, issued_at, fault_level_ka, change_notes, created_at, issued_by',
        )
        .eq('id', revisionId)
        .eq('project_id', projectId)
        .single(),
    ),
    // sources now holds only utility/pv/standby — RMU + mini-sub source
    // types migrated to structure.nodes (migration 00077).
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code, type, rating_kva, voltage_v, notes')
      .eq('revision_id', revisionId)
      .order('code'),
    // Boards became structure.nodes (unified-node model). Nodes are
    // PROJECT-scoped, not revision-scoped — filter by project_id. Queried
    // as a separate cross-schema query: PostgREST embeds across schemas
    // fail PGRST200 in this codebase, so the join into supplies/cables is
    // done in JS below via nodeById.
    (supabase as any)
      .schema('structure')
      .from('nodes')
      .select(
        'id, kind, code, name, coc_required, status, shop_number, shop_name, ' +
        'shop_area_m2, breaker_rating_a, pole_config, section, rating_kva, voltage_v, notes',
      )
      .eq('project_id', projectId)
      .order('code'),
    // supplies feed edges — origin is from_node_id (structure.nodes) XOR
    // from_source_id (cable_schedule.sources); destination is always
    // to_node_id. The legacy from_board_id/to_board_id columns still exist
    // on the table but are abandoned — not read here.
    (supabase as any)
      .schema('cable_schedule')
      .from('supplies')
      .select(
        'id, from_source_id, from_node_id, to_node_id, voltage_v, design_load_a, section',
      )
      .eq('revision_id', revisionId),
    // grouping_arrangement column landed in migration 00064. SELECT is
    // tolerant — if the column isn't applied yet PostgREST returns 42703
    // (undefined column) and the inner retry drops back to the pre-00064
    // projection. The row mapper's `r.grouping_arrangement ?? 'TOUCHING'`
    // default handles the retry path. Same shape as the cost_lines.conductor
    // and revisions.vat_pct tolerances elsewhere in this file.
    selectWithFallbackOn42703(
      () => (supabase as any)
        .schema('cable_schedule')
        .from('cables')
        .select(
          'id, supply_id, cable_no, size_mm2, cores, conductor, insulation, armour, standard, ' +
          'ohm_per_km, measured_length_m, confirmed_length_m, length_status, ' +
          'installation_method, depth_mm, grouped_with, grouping_arrangement, ambient_temp_c, ' +
          'derated_current_rating_a, tag_override, manual_override, notes',
        )
        .eq('revision_id', revisionId)
        // Sort by (supply_id, cable_no) so parallel cables on the same
        // supply are guaranteed contiguous in the returned array. The
        // previous .order('cable_no') alone interleaved parallels across
        // supplies (A1, B1, A2, B2…), which broke the schedule grouping.
        .order('supply_id', { ascending: true })
        .order('cable_no', { ascending: true }),
      () => (supabase as any)
        .schema('cable_schedule')
        .from('cables')
        .select(
          'id, supply_id, cable_no, size_mm2, cores, conductor, insulation, armour, standard, ' +
          'ohm_per_km, measured_length_m, confirmed_length_m, length_status, ' +
          'installation_method, depth_mm, grouped_with, ambient_temp_c, ' +
          'derated_current_rating_a, tag_override, manual_override, notes',
        )
        .eq('revision_id', revisionId)
        .order('supply_id', { ascending: true })
        .order('cable_no', { ascending: true }),
    ),
    (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .select(
        'id, cable_id, end_position, tag_text, printed, printed_at, ' +
        'cable:cables!cable_id(revision_id)',
      ),
    // conductor column landed in migration 00061. SELECT is tolerant —
    // if the column isn't applied yet PostgREST returns 42703 (undefined
    // column) and the inner retry drops back to the pre-00061 projection.
    // The row mapper's `r.conductor ?? 'CU'` default handles the retry
    // path. Same shape as the vat_pct tolerance in cost/page.tsx (c2cfeb2).
    selectWithFallbackOn42703(
      () => (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .select('id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each')
        .eq('revision_id', revisionId)
        .order('size_mm2'),
      () => (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .select('id, size_mm2, supply_rate_per_m, install_rate_per_m, termination_rate_each')
        .eq('revision_id', revisionId)
        .order('size_mm2'),
    ),
    // Same cross-schema gotcha as the revisions query above: changed_by is
    // a UUID into public.profiles which PostgREST can't embed from the
    // cable_schedule profile. Read the raw UUID; resolve to a name below.
    (supabase as any)
      .schema('cable_schedule')
      .from('change_log')
      .select(
        'id, entity_type, entity_id, field_name, old_value, new_value, reason, changed_at, changed_by',
      )
      .eq('revision_id', revisionId)
      .order('changed_at', { ascending: true }),
  ])

  void client // silence linter — supabase typed access is via the `any` chain above
  if (!projectRow || !revisionRow) return null

  const sources = (sourcesData ?? []) as ExportPayload['sources']
  const nodes = (nodesData ?? []) as ExportPayload['nodes']
  const supplies = (suppliesData ?? []) as ExportPayload['supplies']
  const rawCables = (cablesData ?? []) as RawCable[]

  // Filter cable_tags rows to this revision (the join filter is the only
  // way to scope, since cable_tags doesn't carry revision_id directly).
  const cableIdsInRevision = new Set(rawCables.map((c) => c.id))
  const cableTags = ((tagsData ?? []) as any[])
    .filter((t) => cableIdsInRevision.has(t.cable_id))
    .map((t) => ({
      id: t.id,
      cable_id: t.cable_id,
      end_position: t.end_position,
      tag_text: t.tag_text,
      printed: t.printed,
      printed_at: t.printed_at,
    })) as ExportPayload['cableTags']

  // Per-supply VD + cumulative VD
  const supplyForCalc = supplies as unknown as SupplyForCalc[]
  const cableForCalc = rawCables as unknown as CableForCalc[]
  const cumulativeMap = computeCumulativeVdMap(supplyForCalc, cableForCalc, 'as-built')

  const supplyVdById = new Map<string, number>()
  for (const s of supplies) {
    supplyVdById.set(
      s.id,
      voltDropPctForSupply(s as unknown as SupplyForCalc, cableForCalc, 'as-built'),
    )
  }

  // FROM / TO labels via source + node lookup
  const sourceById = new Map(sources.map((s) => [s.id, s] as const))
  const nodeById = new Map(nodes.map((n) => [n.id, n] as const))
  const supplyById = new Map(supplies.map((s) => [s.id, s] as const))

  function entityLabel(id: string | null | undefined): string {
    if (!id) return '?'
    return sourceById.get(id)?.code ?? nodeById.get(id)?.code ?? '?'
  }

  const cables: EnrichedCable[] = rawCables.map((c) => {
    const supply = supplyById.get(c.supply_id)
    const fromLabel = supply
      ? entityLabel(supply.from_source_id ?? supply.from_node_id)
      : '?'
    const toLabel = supply ? entityLabel(supply.to_node_id) : '?'

    return {
      id: c.id,
      supply_id: c.supply_id,
      cable_no: c.cable_no,
      size_mm2: Number(c.size_mm2),
      cores: c.cores,
      conductor: c.conductor,
      insulation: c.insulation,
      armour: c.armour,
      standard: c.standard,
      ohm_per_km: c.ohm_per_km == null ? null : Number(c.ohm_per_km),
      measured_length_m: c.measured_length_m == null ? null : Number(c.measured_length_m),
      confirmed_length_m:
        c.confirmed_length_m == null ? null : Number(c.confirmed_length_m),
      length_status: c.length_status,
      derated_current_rating_a:
        c.derated_current_rating_a == null
          ? null
          : Number(c.derated_current_rating_a),
      installation_method: c.installation_method,
      depth_mm: c.depth_mm == null ? null : Number(c.depth_mm),
      grouped_with: Number(c.grouped_with ?? 1),
      // Default to TOUCHING on the retry path: when migration 00064 isn't
      // applied yet the SELECT above strips the column from the projection,
      // so c.grouping_arrangement is undefined here. TOUCHING also matches
      // the historical lookup default — existing rows behave identically.
      grouping_arrangement: (c.grouping_arrangement ?? 'TOUCHING') as 'TOUCHING' | 'SPACING_D',
      ambient_temp_c: Number(c.ambient_temp_c ?? 30),
      tag_override: c.tag_override,
      manual_override: !!c.manual_override,
      notes: c.notes,

      from_label: fromLabel,
      to_label: toLabel,
      voltage_v: supply ? Number(supply.voltage_v) : null,
      load_a: supply?.design_load_a == null ? null : Number(supply.design_load_a),
      vd_pct: supplyVdById.get(c.supply_id) ?? 0,
      cumulative_vd_pct: cumulativeMap.get(c.supply_id) ?? 0,
      cable_tag: c.tag_override?.trim() || autoTag(fromLabel, toLabel, c.cable_no),
    }
  })

  // ── Collapse cables → runs (one row per supply) ─────────────────────
  // Group strands by supply_id. Within each supply: ordered by cable_no.
  // Shared properties taken from first strand; divergence flagged.
  const cablesBySupply = new Map<string, EnrichedCable[]>()
  for (const cable of cables) {
    const list = cablesBySupply.get(cable.supply_id) ?? []
    list.push(cable)
    cablesBySupply.set(cable.supply_id, list)
  }
  type SharedField = EnrichedRun['mixed_properties']['fields'][number]
  const SHARED_FIELDS: SharedField[] = [
    'size_mm2',
    'cores',
    'conductor',
    'insulation',
    'installation_method',
    'depth_mm',
    'grouped_with',
    'ohm_per_km',
  ]
  const LENGTH_STATUS_RANK: Record<EnrichedCable['length_status'], number> = {
    CONFIRMED: 0,
    MEASURED: 1,
    DISCREPANCY: 2,
    UNMEASURED: 3,
  }

  const runs: EnrichedRun[] = []
  for (const supply of supplies) {
    const strands = (cablesBySupply.get(supply.id) ?? [])
      .slice()
      .sort((a, b) => a.cable_no - b.cable_no)
    if (strands.length === 0) continue // orphan supply — skip from runs view
    const head = strands[0]

    // Mixed-properties diagnostic — empty in the normal case.
    const mixedFields: EnrichedRun['mixed_properties']['fields'] = []
    for (const f of SHARED_FIELDS) {
      const first = (head as any)[f]
      if (strands.some((s) => (s as any)[f] !== first)) mixedFields.push(f as any)
    }

    // Length aggregation: worst (longest) measured length across strands.
    // Length status: worst rank (UNMEASURED beats MEASURED beats CONFIRMED).
    let activeLen: number | null = 0
    for (const s of strands) {
      const l = s.confirmed_length_m ?? s.measured_length_m
      if (l == null) {
        activeLen = null
        break
      }
      if (l > (activeLen ?? 0)) activeLen = l
    }
    const worstStatus = strands.reduce<EnrichedCable['length_status']>(
      (acc, s) => (LENGTH_STATUS_RANK[s.length_status] > LENGTH_STATUS_RANK[acc] ? s.length_status : acc),
      strands[0].length_status,
    )

    // Combined capacity — sum of strands' derated ratings.
    let combinedCap: number | null = 0
    for (const s of strands) {
      if (s.derated_current_rating_a == null) {
        combinedCap = null
        break
      }
      combinedCap += s.derated_current_rating_a
    }
    const designLoad = supply.design_load_a == null ? null : Number(supply.design_load_a)
    const underRated = combinedCap != null && designLoad != null && combinedCap < designLoad

    runs.push({
      supply_id: supply.id,
      section: supply.section,
      from_label: head.from_label,
      to_label: head.to_label,
      voltage_v: Number(supply.voltage_v),
      load_a: designLoad,
      parallel_count: strands.length,

      size_mm2: head.size_mm2,
      cores: head.cores,
      conductor: head.conductor,
      insulation: head.insulation,
      installation_method: head.installation_method,
      depth_mm: head.depth_mm,
      grouped_with: head.grouped_with,
      ohm_per_km: head.ohm_per_km,

      active_length_m: activeLen,
      length_status: worstStatus,

      combined_capacity_a: combinedCap,
      under_rated: underRated,
      vd_pct: supplyVdById.get(supply.id) ?? 0,
      cumulative_vd_pct: cumulativeMap.get(supply.id) ?? 0,

      mixed_properties: { fields: mixedFields as any },
      cables: strands,
    })
  }
  // Canonical sort: section → conductor (CU first) → from → to.
  // The Excel writer groups by section + conductor for its header rows;
  // this matches so the grid + sheet agree on row order.
  runs.sort((a, b) => {
    const sa = a.section ?? ''
    const sb = b.section ?? ''
    if (sa !== sb) return sa.localeCompare(sb)
    if (a.conductor !== b.conductor) return a.conductor.localeCompare(b.conductor)
    if (a.from_label !== b.from_label) return a.from_label.localeCompare(b.from_label, undefined, { numeric: true })
    return a.to_label.localeCompare(b.to_label, undefined, { numeric: true })
  })

  const revisionAny = revisionRow as any

  // Batched cross-schema profile resolution. Replaces the embedded
  // PostgREST joins above which failed PGRST200 because cable_schedule
  // can't resolve FKs into public.profiles. Collect every distinct UUID
  // referenced by issued_by + changed_by, look them all up in one round
  // trip, map to full_name. Profiles RLS still applies — UUIDs the
  // caller can't see resolve to null which keeps the existing "By: -"
  // fallback semantics in the renderers.
  const profileIds = new Set<string>()
  if (revisionAny.issued_by) profileIds.add(revisionAny.issued_by)
  for (const r of (changeLogData ?? []) as any[]) {
    if (r.changed_by) profileIds.add(r.changed_by)
  }
  const nameByProfileId = new Map<string, string | null>()
  if (profileIds.size > 0) {
    const { data: profiles } = await (supabase as any)
      .schema('public')
      .from('profiles')
      .select('id, full_name')
      .in('id', Array.from(profileIds))
    for (const p of (profiles ?? []) as Array<{ id: string; full_name: string | null }>) {
      nameByProfileId.set(p.id, p.full_name?.trim?.() || null)
    }
  }
  const issuedByName = revisionAny.issued_by
    ? nameByProfileId.get(revisionAny.issued_by) ?? null
    : null

  const changeLog = ((changeLogData ?? []) as any[]).map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    field_name: r.field_name,
    old_value: r.old_value,
    new_value: r.new_value,
    reason: r.reason,
    changed_by_name: r.changed_by
      ? nameByProfileId.get(r.changed_by) ?? null
      : null,
    changed_at: r.changed_at,
  })) as ExportPayload['changeLog']

  return {
    costRedacted: false,
    project: projectRow as ExportPayload['project'],
    revision: {
      id: revisionAny.id,
      code: revisionAny.code,
      description: revisionAny.description,
      status: revisionAny.status,
      issued_at: revisionAny.issued_at,
      issued_by_name: issuedByName,
      fault_level_ka:
        revisionAny.fault_level_ka == null ? null : Number(revisionAny.fault_level_ka),
      change_notes: revisionAny.change_notes,
      created_at: revisionAny.created_at,
      // Defaults to null on the retry path (column not projected → undefined).
      // Excel + PDF renderers default null → 15.
      vat_pct: revisionAny.vat_pct == null ? null : Number(revisionAny.vat_pct),
    },
    sources,
    nodes,
    supplies,
    cables,
    runs,
    cableTags,
    costLines: (costData ?? []).map((r: any) => ({
      id: r.id,
      size_mm2: Number(r.size_mm2),
      // Default to CU on the retry path: when migration 00061 isn't
      // applied yet the SELECT above strips the conductor column from
      // the projection, so r.conductor is undefined here.
      conductor: (r.conductor ?? 'CU') as 'CU' | 'AL',
      supply_rate_per_m: Number(r.supply_rate_per_m ?? 0),
      install_rate_per_m: Number(r.install_rate_per_m ?? 0),
      termination_rate_each: Number(r.termination_rate_each ?? 0),
    })) as ExportPayload['costLines'],
    changeLog,
  }
}

/**
 * Default cable-tag pattern when no override is set. Matches the auto-
 * generator that drives the on-screen tag schedule.
 */
function autoTag(from: string, to: string, cableNo: number): string {
  const safe = (s: string) => s.replace(/[^A-Z0-9]/gi, '').toUpperCase()
  return `${safe(from)}-${safe(to)}-C${cableNo}`
}

/**
 * Slug suitable for a download filename: project + rev + status + date.
 * Re-exported from the dedicated module so existing callers keep working.
 */
export { exportFilenameStem } from './export-filename'
