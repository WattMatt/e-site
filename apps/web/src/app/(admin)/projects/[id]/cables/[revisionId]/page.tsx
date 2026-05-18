import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import type { CSSProperties } from 'react'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  supplyParallelCapacity,
  buildStructureTree,
  type StructureFeedSummary,
  type CableForCalc,
  type SupplyForCalc,
  changedCableIds,
  type DiffableCable,
} from '@esite/shared'
import { CableScheduleGrid, type ScheduleRow } from './CableScheduleGrid'
import { type NodeOption } from './CableScheduleGrid'
import type { EnrichedRun, EnrichedCable } from '@/lib/cable-schedule/export-payload'
import { StructureSection } from './StructureSection'
import { LengthModeToggle, type LengthMode } from './LengthModeToggle'
import { ExportMenu } from './ExportMenu'

export const metadata: Metadata = { title: 'Cable schedule revision' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
  searchParams: Promise<{ view?: string }>
}

interface RevisionRow {
  id: string
  project_id: string
  code: string
  description: string | null
  status: 'DRAFT' | 'ISSUED' | 'SUPERSEDED'
  issued_at: string | null
  fault_level_ka: number | null
}

interface SourceRow {
  id: string
  code: string
  type: string
  rating_kva: number | null
  voltage_v: number | null
}

interface BoardRow {
  id: string
  code: string
  kind: string
  tenant_name: string | null
  area_m2: number | null
  breaker_rating_a: number | null
  section: string | null
  parent_board_id: string | null
}

interface SupplyRow extends SupplyForCalc {
  section: string | null
}

interface CableRow extends CableForCalc {
  cores: string
  conductor: 'CU' | 'AL'
  insulation: 'PVC' | 'XLPE' | 'PILC'
  armour: string | null
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  ambient_temp_c: number
  derated_current_rating_a: number | null
  tag_override: string | null
  manual_override: boolean
  notes: string | null
}

export default async function RevisionDetailPage({ params, searchParams }: Props) {
  const { id: projectId, revisionId } = await params
  const sp = await searchParams
  const lengthMode: LengthMode =
    sp.view === 'design' ? 'design'
    : sp.view === 'worst' ? 'worst'
    : 'as-built'
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const [{ data: revisionRow }, { data: priorList }] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, project_id, code, description, status, issued_at, fault_level_ka')
      .eq('id', revisionId)
      .eq('project_id', projectId)
      .single(),
    // Most-recent ISSUED revision (other than this one) for the cloud-marker diff.
    (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, code, created_at')
      .eq('project_id', projectId)
      .eq('status', 'ISSUED')
      .neq('id', revisionId)
      .order('created_at', { ascending: false })
      .limit(1),
  ])
  if (!revisionRow) notFound()
  const revision = revisionRow as RevisionRow
  const priorIssued = ((priorList ?? []) as Array<{ id: string; code: string }>)[0] ?? null

  const [sourcesRes, boardsRes, suppliesRes, cablesRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code, type, rating_kva, voltage_v')
      .eq('revision_id', revisionId)
      .order('code'),
    (supabase as any)
      .schema('cable_schedule')
      .from('boards')
      .select('id, code, kind, tenant_name, area_m2, breaker_rating_a, section, parent_board_id')
      .eq('revision_id', revisionId)
      .order('code'),
    (supabase as any)
      .schema('cable_schedule')
      .from('supplies')
      .select('id, from_source_id, from_board_id, to_board_id, voltage_v, design_load_a, section')
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, supply_id, cable_no, size_mm2, cores, conductor, insulation, armour, ohm_per_km, ' +
        'measured_length_m, confirmed_length_m, length_status, ' +
        'derate_depth, derate_thermal, derate_grouping, derate_temp, ' +
        'derated_current_rating_a, installation_method, depth_mm, grouped_with, ' +
        'ambient_temp_c, tag_override, manual_override, notes',
      )
      .eq('revision_id', revisionId)
      .order('cable_no'),
  ])

  const sources  = (sourcesRes?.data  ?? []) as unknown as SourceRow[]
  const boards   = (boardsRes?.data   ?? []) as unknown as BoardRow[]
  const supplies = (suppliesRes?.data ?? []) as unknown as SupplyRow[]
  const cables   = (cablesRes?.data   ?? []) as unknown as CableRow[]

  const hasConfirmedLengths = cables.some((c) => c.confirmed_length_m != null)

  // Blast-radius counts: how many supplies and cables cascade-delete if a node is removed.
  function blastFor(nodeId: string, category: 'source' | 'board') {
    const hit = supplies.filter((s) =>
      category === 'source'
        ? s.from_source_id === nodeId
        : (s.from_board_id === nodeId || s.to_board_id === nodeId))
    const supplyIds = new Set(hit.map((s) => s.id))
    const cableCount = cables.filter((c) => supplyIds.has(c.supply_id)).length
    return { blastSupplies: hit.length, blastCables: cableCount }
  }


  // Cloud markers: compare current cables against the most-recent ISSUED
  // snapshot. Rows that are new in this revision or have any diffable
  // field changed get a ☁ icon + revision letter in the schedule grid.
  let revCloudAdded = new Set<string>()
  let revCloudChanged = new Set<string>()
  if (priorIssued) {
    const [priorCablesRes] = await Promise.all([
      (supabase as any)
        .schema('cable_schedule')
        .from('cables')
        .select(
          'id, cable_no, size_mm2, cores, conductor, insulation, ' +
          'measured_length_m, confirmed_length_m, length_status, ohm_per_km, ' +
          'installation_method, depth_mm, grouped_with, ambient_temp_c, ' +
          'derated_current_rating_a, tag_override, notes, ' +
          'supply:supplies!supply_id(' +
            'voltage_v, design_load_a, ' +
            'source:sources!from_source_id(code), ' +
            'from_board:boards!from_board_id(code), ' +
            'to_board:boards!to_board_id(code))',
        )
        .eq('revision_id', priorIssued.id),
    ])
    const toDiffable = (rows: any[]): DiffableCable[] => rows.map((c) => ({
      id: c.id,
      cable_no: c.cable_no,
      size_mm2: Number(c.size_mm2),
      cores: c.cores,
      conductor: c.conductor,
      insulation: c.insulation,
      measured_length_m: c.measured_length_m == null ? null : Number(c.measured_length_m),
      confirmed_length_m: c.confirmed_length_m == null ? null : Number(c.confirmed_length_m),
      length_status: c.length_status,
      ohm_per_km: c.ohm_per_km == null ? null : Number(c.ohm_per_km),
      installation_method: c.installation_method,
      depth_mm: c.depth_mm == null ? null : Number(c.depth_mm),
      grouped_with: Number(c.grouped_with ?? 1),
      ambient_temp_c: Number(c.ambient_temp_c ?? 30),
      derated_current_rating_a: c.derated_current_rating_a == null
        ? null
        : Number(c.derated_current_rating_a),
      tag_override: c.tag_override,
      notes: c.notes,
      from_label: c.supply?.source?.code ?? c.supply?.from_board?.code ?? '?',
      to_label: c.supply?.to_board?.code ?? '?',
      voltage_v: c.supply?.voltage_v == null ? null : Number(c.supply.voltage_v),
      load_a: c.supply?.design_load_a == null ? null : Number(c.supply.design_load_a),
    }))
    // Re-fetch current cables with the supply join for accurate diffing
    const { data: currentRich } = await (supabase as any)
      .schema('cable_schedule')
      .from('cables')
      .select(
        'id, cable_no, size_mm2, cores, conductor, insulation, ' +
        'measured_length_m, confirmed_length_m, length_status, ohm_per_km, ' +
        'installation_method, depth_mm, grouped_with, ambient_temp_c, ' +
        'derated_current_rating_a, tag_override, notes, ' +
        'supply:supplies!supply_id(' +
          'voltage_v, design_load_a, ' +
          'source:sources!from_source_id(code), ' +
          'from_board:boards!from_board_id(code), ' +
          'to_board:boards!to_board_id(code))',
      )
      .eq('revision_id', revisionId)
    const { added, changed } = changedCableIds(
      toDiffable((priorCablesRes?.data ?? []) as any[]),
      toDiffable((currentRich ?? []) as any[]),
    )
    revCloudAdded = added
    revCloudChanged = changed
  }

  // Pre-compute volt drop + cumulative VD so the grid renders synchronously.
  const cumulativeMap = computeCumulativeVdMap(
    supplies as SupplyForCalc[],
    cables as CableForCalc[],
    lengthMode,
  )

  const nodeByIdSource = new Map(sources.map((s) => [s.id, s] as const))
  const nodeByIdBoard  = new Map(boards.map((b)  => [b.id, b] as const))

  function nodeLabel(id: string | null): string {
    if (!id) return '—'
    return nodeByIdSource.get(id)?.code ?? nodeByIdBoard.get(id)?.code ?? '?'
  }

  // Per-supply combined parallel capacity (sum of cables' derated ratings) +
  // an under-rated flag (combined capacity below the supply's design load).
  const capacityBySupply = new Map<string, number>()
  for (const sup of supplies) {
    const supCables = cables.filter((c) => c.supply_id === sup.id)
    capacityBySupply.set(sup.id, supplyParallelCapacity(supCables))
  }

  // Actual cable count per supply — drives the per-cable load share.
  const cableCountBySupply = new Map<string, number>()
  for (const sup of supplies) {
    cableCountBySupply.set(sup.id, cables.filter((c) => c.supply_id === sup.id).length)
  }

  // Build grid rows: one row per cable, with FROM / TO / VD / cumulative VD
  // resolved up-front.
  const supplyById = new Map(supplies.map((s) => [s.id, s] as const))
  const cumulativeBySupply = cumulativeMap
  const supplyVdById = new Map<string, number>()
  for (const s of supplies) {
    supplyVdById.set(s.id, voltDropPctForSupply(s, cables as CableForCalc[], lengthMode))
  }

  // Per-supply feed summary for the structure tree's edge labels.
  const cablesBySupply = new Map<string, CableRow[]>()
  for (const c of cables) {
    const list = cablesBySupply.get(c.supply_id) ?? []
    list.push(c)
    cablesBySupply.set(c.supply_id, list)
  }
  const feedSummaryBySupply = new Map<string, StructureFeedSummary>()
  for (const sup of supplies) {
    const supCables = cablesBySupply.get(sup.id) ?? []
    const first = supCables[0]
    const allSame = supCables.length > 0 && supCables.every(
      (c) => c.size_mm2 === first!.size_mm2 && c.conductor === first!.conductor,
    )
    const sizeLabel = supCables.length === 0
      ? '—'
      : allSame
        ? `${supCables.length}×${first!.size_mm2}mm² ${first!.conductor === 'CU' ? 'Cu' : 'Al'}`
        : `${supCables.length} cables (mixed)`
    feedSummaryBySupply.set(sup.id, {
      cableCount: supCables.length,
      sizeLabel,
      vdPct: supplyVdById.get(sup.id) ?? 0,
      underRated: sup.design_load_a != null
        && (capacityBySupply.get(sup.id) ?? 0) < sup.design_load_a,
    })
  }

  const { roots: structureRoots, unfed: structureUnfed } = buildStructureTree(
    sources.map((s) => ({ id: s.id, code: s.code, type: s.type })),
    boards.map((b) => ({ id: b.id, code: b.code, kind: b.kind })),
    supplies.map((s) => ({
      id: s.id, from_source_id: s.from_source_id, from_board_id: s.from_board_id, to_board_id: s.to_board_id,
    })),
    {
      feedSummaryFor: (id) => feedSummaryBySupply.get(id) ?? null,
      blastFor,
    },
  )

  // Revision-cloud letter (matches the drawing convention — e.g. "8" from "Rev 8").
  const revLetter = revision.code.replace(/^rev\s*/i, '').trim() || revision.code

  const headerNavLinkStyle: CSSProperties = {
    background: 'var(--c-panel)',
    border: '1px solid var(--c-border)',
    color: 'var(--c-text-mid)',
    borderRadius: 6,
    padding: '9px 16px',
    fontSize: 13,
    fontFamily: 'var(--font-sans)',
    textDecoration: 'none',
    display: 'inline-flex',
    alignItems: 'center',
    gap: 6,
  }

  const rows: ScheduleRow[] = cables.map((c) => {
    const supply = supplyById.get(c.supply_id)
    if (!supply) {
      return {
        id: c.id,
        cable_no: c.cable_no,
        from_label: '?',
        to_label: '?',
        voltage_v: null,
        load_a: null,
        per_cable_load_a: null,
        size_mm2: c.size_mm2,
        cores: c.cores,
        conductor: c.conductor,
        insulation: c.insulation,
        ohm_per_km: c.ohm_per_km,
        measured_length_m: c.measured_length_m,
        confirmed_length_m: c.confirmed_length_m,
        length_status: c.length_status,
        vd_pct: 0,
        cumulative_vd_pct: 0,
        derated_rating_a: c.derated_current_rating_a,
        combined_capacity_a: 0,
        supply_under_rated: false,
        installation_method: c.installation_method,
        depth_mm: c.depth_mm,
        grouped_with: c.grouped_with,
        tag_override: c.tag_override,
        manual_override: c.manual_override,
        notes: c.notes,
        cloud_kind: null,
        cloud_letter: revLetter,
        supply_id: c.supply_id,
        // No supply resolved for this cable — empty-string sentinel; the Task 12
        // re-point picker treats a falsy from/to_node_id as "unrouted".
        from_node_id: '',
        to_node_id: '',
        armour: c.armour,
        section: null,
        ambient_temp_c: Number(c.ambient_temp_c ?? 30),
      }
    }
    return {
      id: c.id,
      cable_no: c.cable_no,
      from_label: nodeLabel(supply.from_source_id ?? supply.from_board_id),
      to_label: nodeLabel(supply.to_board_id),
      voltage_v: supply.voltage_v,
      load_a: supply.design_load_a,
      per_cable_load_a: (() => {
        const n = cableCountBySupply.get(c.supply_id) ?? 0
        return n > 0 && supply.design_load_a != null ? supply.design_load_a / n : null
      })(),
      size_mm2: c.size_mm2,
      cores: c.cores,
      conductor: c.conductor,
      insulation: c.insulation,
      ohm_per_km: c.ohm_per_km,
      measured_length_m: c.measured_length_m,
      confirmed_length_m: c.confirmed_length_m,
      length_status: c.length_status,
      vd_pct: supplyVdById.get(c.supply_id) ?? 0,
      cumulative_vd_pct: cumulativeBySupply.get(c.supply_id) ?? 0,
      derated_rating_a: c.derated_current_rating_a,
      combined_capacity_a: capacityBySupply.get(c.supply_id) ?? 0,
      supply_under_rated: supply.design_load_a != null
        && (capacityBySupply.get(c.supply_id) ?? 0) < supply.design_load_a,
      installation_method: c.installation_method,
      depth_mm: c.depth_mm,
      grouped_with: c.grouped_with,
      tag_override: c.tag_override,
      manual_override: c.manual_override,
      notes: c.notes,
      cloud_kind: revCloudAdded.has(c.id) ? 'added' as const
              : revCloudChanged.has(c.id) ? 'changed' as const
              : null,
      cloud_letter: revLetter,
      supply_id: c.supply_id,
      from_node_id: supply.from_source_id ?? supply.from_board_id ?? '',
      to_node_id: supply.to_board_id,
      armour: c.armour,
      section: supply.section,
      ambient_temp_c: Number(c.ambient_temp_c ?? 30),
    }
  })

  // ── Derive runs (one per supply) from the per-cable rows ─────────────
  // The grid renders ONE row per RUN, with parallel strands collapsed under
  // a "×N" indicator + expand drill-down. See export-payload.ts for the
  // canonical projection used by the exporters; this in-page derivation
  // mirrors that shape using the data the page already has loaded.
  const SHARED_FIELDS_FOR_DIVERGENCE: Array<
    keyof Pick<ScheduleRow,
      'size_mm2' | 'cores' | 'conductor' | 'insulation'
      | 'installation_method' | 'depth_mm' | 'grouped_with' | 'ohm_per_km'>
  > = [
    'size_mm2', 'cores', 'conductor', 'insulation',
    'installation_method', 'depth_mm', 'grouped_with', 'ohm_per_km',
  ]
  const LENGTH_STATUS_RANK: Record<ScheduleRow['length_status'], number> = {
    CONFIRMED: 0, MEASURED: 1, DISCREPANCY: 2, UNMEASURED: 3,
  }
  // Convert a ScheduleRow back to the EnrichedCable shape the run cares about.
  function toEnrichedCable(r: ScheduleRow): EnrichedCable {
    return {
      id: r.id,
      supply_id: r.supply_id,
      cable_no: r.cable_no,
      size_mm2: r.size_mm2,
      cores: r.cores as EnrichedCable['cores'],
      conductor: r.conductor,
      insulation: r.insulation,
      armour: r.armour,
      standard: null,
      ohm_per_km: r.ohm_per_km,
      measured_length_m: r.measured_length_m,
      confirmed_length_m: r.confirmed_length_m,
      length_status: r.length_status,
      derated_current_rating_a: r.derated_rating_a,
      installation_method: r.installation_method,
      depth_mm: r.depth_mm,
      grouped_with: r.grouped_with,
      // grouping_arrangement isn't carried on ScheduleRow today (the in-page
      // derivation only needs it for the runs-mixed-properties check, which
      // we don't yet flag). Default to TOUCHING — matches historic factor
      // and the new column's DB default. CableFormModal reads/writes the
      // real value via the strand head from the export-payload loader.
      grouping_arrangement: 'TOUCHING',
      ambient_temp_c: r.ambient_temp_c,
      tag_override: r.tag_override,
      manual_override: r.manual_override,
      notes: r.notes,
      from_label: r.from_label,
      to_label: r.to_label,
      voltage_v: r.voltage_v,
      load_a: r.load_a,
      vd_pct: r.vd_pct,
      cumulative_vd_pct: r.cumulative_vd_pct,
      cable_tag: r.tag_override ?? `${r.from_label}-${r.to_label}-C${r.cable_no}`,
    }
  }
  const rowsBySupply = new Map<string, ScheduleRow[]>()
  for (const r of rows) {
    const list = rowsBySupply.get(r.supply_id) ?? []
    list.push(r)
    rowsBySupply.set(r.supply_id, list)
  }
  const runs: EnrichedRun[] = []
  for (const supply of supplies) {
    const strands = (rowsBySupply.get(supply.id) ?? []).slice().sort((a, b) => a.cable_no - b.cable_no)
    if (strands.length === 0) continue
    const head = strands[0]
    const mixedFields: EnrichedRun['mixed_properties']['fields'] = []
    for (const f of SHARED_FIELDS_FOR_DIVERGENCE) {
      const first = (head as any)[f]
      if (strands.some((s) => (s as any)[f] !== first)) {
        mixedFields.push(f as never)
      }
    }
    let activeLen: number | null = 0
    for (const s of strands) {
      const l = s.confirmed_length_m ?? s.measured_length_m
      if (l == null) { activeLen = null; break }
      if (l > (activeLen ?? 0)) activeLen = l
    }
    const worstStatus = strands.reduce<ScheduleRow['length_status']>(
      (acc, s) => (LENGTH_STATUS_RANK[s.length_status] > LENGTH_STATUS_RANK[acc] ? s.length_status : acc),
      strands[0].length_status,
    )
    let combinedCap: number | null = 0
    for (const s of strands) {
      if (s.derated_rating_a == null) { combinedCap = null; break }
      combinedCap += s.derated_rating_a
    }
    runs.push({
      supply_id: supply.id,
      section: supply.section ?? null,
      from_label: head.from_label,
      to_label: head.to_label,
      voltage_v: Number(supply.voltage_v ?? head.voltage_v ?? 0),
      load_a: head.load_a,
      parallel_count: strands.length,
      size_mm2: head.size_mm2,
      cores: head.cores as EnrichedRun['cores'],
      conductor: head.conductor,
      insulation: head.insulation,
      installation_method: head.installation_method,
      depth_mm: head.depth_mm,
      grouped_with: head.grouped_with,
      ohm_per_km: head.ohm_per_km,
      active_length_m: activeLen,
      length_status: worstStatus,
      combined_capacity_a: combinedCap,
      under_rated: combinedCap != null && head.load_a != null && combinedCap < head.load_a,
      vd_pct: head.vd_pct,
      cumulative_vd_pct: head.cumulative_vd_pct,
      mixed_properties: { fields: mixedFields },
      cables: strands.map(toEnrichedCable),
    })
  }
  // Sort canonically — section → conductor → from → to. Matches what
  // export-payload.ts uses so the on-screen grid and Excel/PDF agree.
  runs.sort((a, b) => {
    const sa = a.section ?? ''
    const sb = b.section ?? ''
    if (sa !== sb) return sa.localeCompare(sb)
    if (a.conductor !== b.conductor) return a.conductor.localeCompare(b.conductor)
    if (a.from_label !== b.from_label) return a.from_label.localeCompare(b.from_label, undefined, { numeric: true })
    return a.to_label.localeCompare(b.to_label, undefined, { numeric: true })
  })

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Revisions · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">
            {revision.code}
            <span
              className={`badge ${
                revision.status === 'DRAFT' ? 'badge-warning'
                : revision.status === 'ISSUED' ? 'badge-success'
                : 'badge-muted'
              }`}
              style={{ marginLeft: 12, verticalAlign: 'middle' }}
            >
              {revision.status}
            </span>
          </h1>
          <p className="page-subtitle">
            {project.name} · {sources.length} source{sources.length !== 1 ? 's' : ''} ·
            {' '}{boards.length} board{boards.length !== 1 ? 's' : ''} ·
            {' '}{supplies.length} suppl{supplies.length !== 1 ? 'ies' : 'y'} ·
            {' '}{cables.length} cable{cables.length !== 1 ? 's' : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <div style={{ display: 'inline-flex', gap: 8, flexWrap: 'wrap' }}>
            <Link href={`/projects/${projectId}/cables/${revisionId}/tags`} style={headerNavLinkStyle}>🏷 Tag schedule</Link>
            <Link href={`/projects/${projectId}/cables/${revisionId}/cost`} style={headerNavLinkStyle}>💰 Cost summary</Link>
            <Link href={`/projects/${projectId}/cables/${revisionId}/diff`} style={headerNavLinkStyle}
              title={priorIssued ? `Diff against ${priorIssued.code}` : 'No prior issued revision to diff against'}>🔀 Diff</Link>
            <Link href={`/projects/${projectId}/cables/${revisionId}/discrepancies`} style={headerNavLinkStyle}>📐 Discrepancies</Link>
          </div>
          <div style={{ display: 'inline-flex', gap: 10, alignItems: 'center', flexWrap: 'wrap' }}>
            <LengthModeToggle
              basePath={`/projects/${projectId}/cables/${revisionId}`}
              current={lengthMode}
              hasConfirmedLengths={hasConfirmedLengths}
            />
            <ExportMenu projectId={projectId} revisionId={revisionId} />
          </div>
        </div>
      </div>

      <StructureSection
        projectId={projectId}
        revisionId={revision.id}
        roots={structureRoots}
        unfed={structureUnfed}
        canEdit={revision.status === 'DRAFT'}
        sources={sources.map<NodeOption>((s) => ({ id: s.id, code: s.code, kind: 'source' }))}
        boards={boards.map<NodeOption>((b) => ({ id: b.id, code: b.code, kind: 'board' }))}
        addPanelDefaultOpen={cables.length === 0}
      >
        {cables.length === 0 ? (
          <div className="data-panel">
            <div
              className="data-panel-empty"
              style={{ padding: '48px 18px', textAlign: 'center' }}
            >
              ⚡ No cables in this revision yet.
              <div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 6 }}>
                Build your <strong>Structure</strong> above (sources and boards), then use{' '}
                <strong>+ Add cable</strong> below to start the schedule. Cable rows auto-fill Ω/km +
                base rating from the bundled SANS library. To bulk-load from an existing
                workbook, use <strong>⬆ Import Excel</strong> from the revisions list.
              </div>
            </div>
          </div>
        ) : (
          <CableScheduleGrid
            projectId={projectId}
            revisionId={revisionId}
            rows={rows}
            runs={runs}
            supplies={supplies as SupplyForCalc[]}
            cables={cables as CableForCalc[]}
            nodeOptions={[
              ...sources.map((s) => ({ id: s.id, code: s.code, kind: 'source' as const })),
              ...boards.map((b) => ({ id: b.id, code: b.code, kind: 'board' as const })),
            ]}
            locked={revision.status !== 'DRAFT'}
            lengthMode={lengthMode}
            canEdit={revision.status === 'DRAFT'}
          />
        )}
      </StructureSection>
    </div>
  )
}

