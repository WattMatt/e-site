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
} from '@esite/shared'
import { CableScheduleGrid, type ScheduleRow } from './CableScheduleGrid'
import { AddEntityPanel, type NodeOption, type SupplyOption } from './AddEntityPanel'

export const metadata: Metadata = { title: 'Cable schedule revision' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
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
  installation_method: string | null
  depth_mm: number | null
  grouped_with: number
  ambient_temp_c: number
  derated_current_rating_a: number | null
  tag_override: string | null
  manual_override: boolean
  notes: string | null
}

export default async function RevisionDetailPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const { data: revisionRow } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, project_id, code, description, status, issued_at, fault_level_ka')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!revisionRow) notFound()
  const revision = revisionRow as RevisionRow

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
        'id, supply_id, cable_no, size_mm2, cores, conductor, insulation, ohm_per_km, ' +
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

  // Pre-compute volt drop + cumulative VD so the grid renders synchronously.
  const cumulativeMap = computeCumulativeVdMap(
    supplies as SupplyForCalc[],
    cables as CableForCalc[],
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
    supplyVdById.set(s.id, voltDropPctForSupply(s, cables as CableForCalc[]))
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
              bundled SANS library. Bulk import via Excel arrives in C-7.
            </div>
          </div>
        </div>
      ) : (
        <CableScheduleGrid rows={rows} locked={revision.status !== 'DRAFT'} />
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
