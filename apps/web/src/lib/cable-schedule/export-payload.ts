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
    (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select(
        'id, code, description, status, issued_at, fault_level_ka, change_notes, created_at, ' +
        'issued_by_profile:profiles!issued_by(full_name)',
      )
      .eq('id', revisionId)
      .eq('project_id', projectId)
      .single(),
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
      .order('cable_no'),
    (supabase as any)
      .schema('cable_schedule')
      .from('cable_tags')
      .select(
        'id, cable_id, end_position, tag_text, printed, printed_at, ' +
        'cable:cables!cable_id(revision_id)',
      ),
    (supabase as any)
      .schema('cable_schedule')
      .from('cost_lines')
      .select('id, size_mm2, supply_rate_per_m, install_rate_per_m, termination_rate_each')
      .eq('revision_id', revisionId)
      .order('size_mm2'),
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
    },
    sources,
    boards,
    supplies,
    cables,
    cableTags,
    costLines: (costData ?? []).map((r: any) => ({
      id: r.id,
      size_mm2: Number(r.size_mm2),
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
