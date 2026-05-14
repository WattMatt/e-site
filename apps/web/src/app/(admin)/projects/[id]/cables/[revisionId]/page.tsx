import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import {
  computeCumulativeVdMap,
  voltDropPctForSupply,
  type CableForCalc,
  type SupplyForCalc,
  changedCableIds,
  type DiffableCable,
} from '@esite/shared'
import { CableScheduleGrid, type ScheduleRow } from './CableScheduleGrid'
import { AddEntityPanel, type NodeOption, type SupplyOption } from './AddEntityPanel'
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
      .select('id, code, tenant_name, area_m2, breaker_rating_a, section, parent_board_id')
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

  // Build grid rows: one row per cable, with FROM / TO / VD / cumulative VD
  // resolved up-front.
  const supplyById = new Map(supplies.map((s) => [s.id, s] as const))
  const cumulativeBySupply = cumulativeMap
  const supplyVdById = new Map<string, number>()
  for (const s of supplies) {
    supplyVdById.set(s.id, voltDropPctForSupply(s, cables as CableForCalc[], lengthMode))
  }

  // Revision-cloud letter (matches the drawing convention — e.g. "8" from "Rev 8").
  const revLetter = revision.code.replace(/^rev\s*/i, '').trim() || revision.code

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
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/tags`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
          >
            🏷 Tag schedule
          </Link>
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/cost`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
          >
            💰 Cost summary
          </Link>
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/diff`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
            title={priorIssued ? `Diff against ${priorIssued.code}` : 'No prior issued revision to diff against'}
          >
            🔀 Diff
          </Link>
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/discrepancies`}
            className="btn-primary-amber"
            style={{
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)',
              textDecoration: 'none',
            }}
          >
            📐 Discrepancies
          </Link>
          <LengthModeToggle
            basePath={`/projects/${projectId}/cables/${revisionId}`}
            current={lengthMode}
          />
          <ExportMenu projectId={projectId} revisionId={revisionId} />
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: '1fr 1fr',
          gap: 16,
          marginBottom: 16,
        }}
      >
        <SourcesPanel sources={sources} />
        <BoardsPanel boards={boards} />
      </div>

      {revision.status === 'DRAFT' && (
        <AddEntityPanel
          revisionId={revision.id}
          sources={sources.map<NodeOption>((s) => ({ id: s.id, code: s.code, kind: 'source' }))}
          boards={boards.map<NodeOption>((b) => ({ id: b.id, code: b.code, kind: 'board' }))}
          supplies={supplies.map<SupplyOption>((s) => ({
            id: s.id,
            fromLabel: nodeLabel(s.from_source_id ?? s.from_board_id),
            toLabel:   nodeLabel(s.to_board_id),
            voltage_v: s.voltage_v,
            load_a:    s.design_load_a,
          }))}
        />
      )}

      {cables.length === 0 ? (
        <div className="data-panel">
          <div
            className="data-panel-empty"
            style={{ padding: '48px 18px', textAlign: 'center' }}
          >
            ⚡ No cables in this revision yet.
            <div
              style={{
                fontSize: 13,
                color: 'var(--c-text-dim)',
                marginTop: 6,
              }}
            >
              Use <strong>+ Add to schedule</strong> above to add sources, boards,
              supplies and cables. Cable rows auto-fill Ω/km + base rating from the
              bundled SANS library. To bulk-load from an existing workbook, use
              <strong> ⬆ Import Excel</strong> from the revisions list.
            </div>
          </div>
        </div>
      ) : (
        <CableScheduleGrid
          projectId={projectId}
          revisionId={revisionId}
          rows={rows}
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
    </div>
  )
}

function SourcesPanel({ sources }: { sources: SourceRow[] }) {
  return (
    <div className="data-panel">
      <div className="data-panel-header">
        <span className="data-panel-title">Sources ({sources.length})</span>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {sources.length === 0 ? (
          <div style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            None yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {sources.map((s) => (
              <li key={s.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--c-text)' }}>
                  {s.code}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
                  {s.type}{s.rating_kva ? ` · ${s.rating_kva} kVA` : ''}{s.voltage_v ? ` · ${s.voltage_v} V` : ''}
                </span>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

function BoardsPanel({ boards }: { boards: BoardRow[] }) {
  return (
    <div className="data-panel">
      <div className="data-panel-header">
        <span className="data-panel-title">Boards ({boards.length})</span>
      </div>
      <div style={{ padding: '12px 18px' }}>
        {boards.length === 0 ? (
          <div style={{ color: 'var(--c-text-dim)', fontSize: 13, fontStyle: 'italic' }}>
            None yet.
          </div>
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
            {boards.slice(0, 12).map((b) => (
              <li key={b.id} style={{ display: 'flex', alignItems: 'baseline', gap: 8 }}>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 600, color: 'var(--c-text)' }}>
                  {b.code}
                </span>
                <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                  {b.breaker_rating_a ? `${b.breaker_rating_a} A` : ''}
                  {b.section ? ` · ${b.section}` : ''}
                  {b.tenant_name ? ` · ${b.tenant_name}` : ''}
                </span>
              </li>
            ))}
            {boards.length > 12 && (
              <li style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                +{boards.length - 12} more
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}
