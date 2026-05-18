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

export interface ExportPayload {
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
  sources: Array<{
    id: string
    code: string
    type: string
    rating_kva: number | null
    voltage_v: number | null
    notes: string | null
  }>
  boards: Array<{
    id: string
    code: string
    tenant_name: string | null
    area_m2: number | null
    breaker_rating_a: number | null
    pole_config: string | null
    section: string | null
    parent_board_id: string | null
  }>
  supplies: Array<{
    id: string
    from_source_id: string | null
    from_board_id: string | null
    to_board_id: string | null
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
    { data: boardsData },
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
    (async () => {
      const withVat = await (supabase as any)
        .schema('cable_schedule')
        .from('revisions')
        .select(
          'id, code, description, status, issued_at, fault_level_ka, change_notes, created_at, vat_pct, ' +
          'issued_by_profile:profiles!issued_by(full_name)',
        )
        .eq('id', revisionId)
        .eq('project_id', projectId)
        .single()
      if (withVat.error?.code === '42703') {
        return await (supabase as any)
          .schema('cable_schedule')
          .from('revisions')
          .select(
            'id, code, description, status, issued_at, fault_level_ka, change_notes, created_at, ' +
            'issued_by_profile:profiles!issued_by(full_name)',
          )
          .eq('id', revisionId)
          .eq('project_id', projectId)
          .single()
      }
      return withVat
    })(),
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code, type, rating_kva, voltage_v, notes')
      .eq('revision_id', revisionId)
      .order('code'),
    (supabase as any)
      .schema('cable_schedule')
      .from('boards')
      .select(
        'id, code, tenant_name, area_m2, breaker_rating_a, pole_config, section, parent_board_id',
      )
      .eq('revision_id', revisionId)
      .order('code'),
    (supabase as any)
      .schema('cable_schedule')
      .from('supplies')
      .select(
        'id, from_source_id, from_board_id, to_board_id, voltage_v, design_load_a, section',
      )
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, supply_id, cable_no, size_mm2, cores, conductor, insulation, armour, standard, ' +
        'ohm_per_km, measured_length_m, confirmed_length_m, length_status, ' +
        'installation_method, depth_mm, grouped_with, ambient_temp_c, ' +
        'derated_current_rating_a, tag_override, manual_override, notes',
      )
      .eq('revision_id', revisionId)
      // Sort by (supply_id, cable_no) so parallel cables on the same
      // supply are guaranteed contiguous in the returned array. The
      // previous .order('cable_no') alone interleaved parallels across
      // supplies (A1, B1, A2, B2…), which broke the schedule grouping.
      .order('supply_id', { ascending: true })
      .order('cable_no', { ascending: true }),
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
    (async () => {
      const withConductor = await (supabase as any)
        .schema('cable_schedule')
        .from('cost_lines')
        .select('id, size_mm2, conductor, supply_rate_per_m, install_rate_per_m, termination_rate_each')
        .eq('revision_id', revisionId)
        .order('size_mm2')
      if (withConductor.error?.code === '42703') {
        return await (supabase as any)
          .schema('cable_schedule')
          .from('cost_lines')
          .select('id, size_mm2, supply_rate_per_m, install_rate_per_m, termination_rate_each')
          .eq('revision_id', revisionId)
          .order('size_mm2')
      }
      return withConductor
    })(),
    (supabase as any)
      .schema('cable_schedule')
      .from('change_log')
      .select(
        'id, entity_type, entity_id, field_name, old_value, new_value, reason, changed_at, ' +
        'changed_by_profile:profiles!changed_by(full_name)',
      )
      .eq('revision_id', revisionId)
      .order('changed_at', { ascending: true }),
  ])

  void client // silence linter — supabase typed access is via the `any` chain above
  if (!projectRow || !revisionRow) return null

  const sources = (sourcesData ?? []) as ExportPayload['sources']
  const boards = (boardsData ?? []) as ExportPayload['boards']
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

  // FROM / TO labels via source + board lookup
  const sourceById = new Map(sources.map((s) => [s.id, s] as const))
  const boardById = new Map(boards.map((b) => [b.id, b] as const))
  const supplyById = new Map(supplies.map((s) => [s.id, s] as const))

  function nodeLabel(id: string | null | undefined): string {
    if (!id) return '?'
    return sourceById.get(id)?.code ?? boardById.get(id)?.code ?? '?'
  }

  const cables: EnrichedCable[] = rawCables.map((c) => {
    const supply = supplyById.get(c.supply_id)
    const fromLabel = supply
      ? nodeLabel(supply.from_source_id ?? supply.from_board_id)
      : '?'
    const toLabel = supply ? nodeLabel(supply.to_board_id) : '?'

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
  const issuedByName =
    revisionAny.issued_by_profile?.full_name?.trim?.() || null

  const changeLog = ((changeLogData ?? []) as any[]).map((r) => ({
    id: r.id,
    entity_type: r.entity_type,
    entity_id: r.entity_id,
    field_name: r.field_name,
    old_value: r.old_value,
    new_value: r.new_value,
    reason: r.reason,
    changed_by_name: r.changed_by_profile?.full_name?.trim?.() || null,
    changed_at: r.changed_at,
  })) as ExportPayload['changeLog']

  return {
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
    boards,
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
 * Slug suitable for a download filename: project + rev + safe chars.
 */
export function exportFilenameStem(payload: ExportPayload): string {
  const proj = payload.project.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '')
  const rev = payload.revision.code.replace(/\s+/g, '').toLowerCase()
  return `${proj}-${rev}-cable-schedule`
}
