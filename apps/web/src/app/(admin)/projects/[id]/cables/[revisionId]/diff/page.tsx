import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { TableScrollX } from '@/components/ui/TableScrollX'
import { projectService, diffRevisions, type DiffableCable } from '@esite/shared'

export const metadata: Metadata = { title: 'Revision diff' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
  searchParams: Promise<{ vs?: string }>
}

interface RevisionStub {
  id: string
  code: string
  status: string
  issued_at: string | null
  created_at: string
}

async function loadDiffable(
  supabase: any,
  revisionId: string,
  labelById: Map<string, string>,
): Promise<DiffableCable[]> {
  const { data: cables } = await supabase
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, cable_no, size_mm2, cores, conductor, insulation, ' +
      'measured_length_m, confirmed_length_m, length_status, ohm_per_km, ' +
      'installation_method, depth_mm, grouped_with, ambient_temp_c, ' +
      'derated_current_rating_a, tag_override, notes, ' +
      'supply:supplies!supply_id(' +
        'voltage_v, design_load_a, from_source_id, from_node_id, to_node_id)',
    )
    .eq('revision_id', revisionId)
  const label = (id: string | null | undefined): string =>
    (id && labelById.get(id)) || '?'
  return ((cables ?? []) as any[]).map((c) => ({
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
    from_label: label(c.supply?.from_source_id ?? c.supply?.from_node_id),
    to_label: label(c.supply?.to_node_id),
    voltage_v: c.supply?.voltage_v == null ? null : Number(c.supply.voltage_v),
    load_a: c.supply?.design_load_a == null ? null : Number(c.supply.design_load_a),
  }))
}

export default async function RevisionDiffPage({ params, searchParams }: Props) {
  const { id: projectId, revisionId } = await params
  const { vs } = await searchParams
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // Load current revision header + the list of others on the same project
  const [currRes, listRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, code, status, issued_at, created_at')
      .eq('id', revisionId)
      .eq('project_id', projectId)
      .single(),
    (supabase as any)
      .schema('cable_schedule')
      .from('revisions')
      .select('id, code, status, issued_at, created_at')
      .eq('project_id', projectId)
      .order('created_at', { ascending: true }),
  ])
  const current = currRes?.data as RevisionStub | null
  if (!current) notFound()
  const allRevs = (listRes?.data ?? []) as RevisionStub[]

  // Pick the comparison revision: explicit `vs` param > previous (most
  // recently created before this one) > most recent ISSUED.
  let compareRev: RevisionStub | null
  if (vs) {
    compareRev = allRevs.find((r) => r.id === vs) ?? null
  } else {
    const idx = allRevs.findIndex((r) => r.id === current.id)
    compareRev = idx > 0 ? allRevs[idx - 1]! : null
  }

  if (!compareRev) {
    return (
      <div className="animate-fadeup">
        <BackLink projectId={projectId} revisionId={revisionId} code={current.code} projectName={project.name} />
        <div className="page-header">
          <div>
            <h1 className="page-title">Revision diff</h1>
            <p className="page-subtitle">Nothing to diff against — {current.code} is the first revision on this project.</p>
          </div>
        </div>
      </div>
    )
  }

  // Build a label map: source codes + node codes (structure.nodes is
  // project-scoped, so one fetch covers both revisions being diffed).
  // Cross-schema PostgREST embeds fail (PGRST200) — resolve labels in JS.
  const [sourcesRes, nodesRes] = await Promise.all([
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code')
      .in('revision_id', [compareRev.id, current.id]),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code')
      .eq('project_id', projectId),
  ])
  const labelById = new Map<string, string>()
  for (const s of (sourcesRes?.data ?? []) as Array<{ id: string; code: string }>) {
    labelById.set(s.id, s.code)
  }
  for (const n of (nodesRes?.data ?? []) as Array<{ id: string; code: string }>) {
    labelById.set(n.id, n.code)
  }

  const [prevCables, currentCables] = await Promise.all([
    loadDiffable(supabase, compareRev.id, labelById),
    loadDiffable(supabase, current.id, labelById),
  ])
  const diff = diffRevisions(prevCables, currentCables)

  return (
    <div className="animate-fadeup">
      <BackLink projectId={projectId} revisionId={revisionId} code={current.code} projectName={project.name} />

      <div className="page-header">
        <div>
          <h1 className="page-title">
            Diff · <span style={{ color: 'var(--c-text-mid)' }}>{compareRev.code}</span>
            {' '}→ <span style={{ color: 'var(--c-text)' }}>{current.code}</span>
          </h1>
          <p className="page-subtitle">
            <strong style={{ color: 'var(--c-green)' }}>+{diff.summary.added}</strong> added ·{' '}
            <strong style={{ color: 'var(--c-red)' }}>−{diff.summary.removed}</strong> removed ·{' '}
            <strong style={{ color: 'var(--c-amber)' }}>~{diff.summary.changed}</strong> changed ·{' '}
            {diff.summary.same} unchanged
          </p>
        </div>
        <CompareSelector
          basePath={`/projects/${projectId}/cables/${revisionId}/diff`}
          current={compareRev.id}
          revisions={allRevs.filter((r) => r.id !== current.id)}
        />
      </div>

      <TableScrollX className="data-panel">
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, fontFamily: 'var(--font-mono)' }}>
          <thead>
            <tr style={{ background: 'var(--c-base)' }}>
              <Th w={40}></Th>
              <Th>Cable key</Th>
              <Th>From → To</Th>
              <Th align="right">Size</Th>
              <Th align="right">C/no</Th>
              <Th>Changes</Th>
            </tr>
          </thead>
          <tbody>
            {diff.entries.filter((e) => e.kind !== 'same').map((e) => (
              <tr
                key={e.key}
                style={{
                  borderTop: '1px solid var(--c-border)',
                  background:
                    e.kind === 'added'   ? 'var(--c-green-dim)'
                    : e.kind === 'removed' ? 'var(--c-red-dim)'
                    : 'var(--c-amber-dim)',
                }}
              >
                <Td>
                  <span style={{
                    display: 'inline-block', width: 20, textAlign: 'center', fontWeight: 700,
                    color:
                      e.kind === 'added'   ? 'var(--c-green)'
                      : e.kind === 'removed' ? 'var(--c-red)'
                      : 'var(--c-amber)',
                  }}>
                    {e.kind === 'added' ? '+' : e.kind === 'removed' ? '−' : '~'}
                  </span>
                </Td>
                <Td>
                  <span style={{
                    textDecoration: e.kind === 'removed' ? 'line-through' : undefined,
                    color: 'var(--c-text)',
                  }}>
                    {e.key}
                  </span>
                </Td>
                <Td>
                  {(e.next ?? e.prev)!.from_label} → {(e.next ?? e.prev)!.to_label}
                </Td>
                <Td align="right">{(e.next ?? e.prev)!.size_mm2}</Td>
                <Td align="right">{(e.next ?? e.prev)!.cable_no}</Td>
                <Td>
                  {e.kind === 'added' && <em style={{ color: 'var(--c-green)' }}>new in this revision</em>}
                  {e.kind === 'removed' && <em style={{ color: 'var(--c-red)' }}>not in this revision</em>}
                  {e.kind === 'changed' && (
                    <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
                      {e.deltas.map((d) => (
                        <li key={d.field} style={{ fontFamily: 'inherit' }}>
                          <span style={{ color: 'var(--c-text-dim)' }}>{d.field}:</span>{' '}
                          <span style={{ color: 'var(--c-text-mid)', textDecoration: 'line-through' }}>
                            {fmt(d.old)}
                          </span>
                          {' → '}
                          <span style={{ color: 'var(--c-amber)', fontWeight: 600 }}>
                            {fmt(d.next)}
                          </span>
                        </li>
                      ))}
                    </ul>
                  )}
                </Td>
              </tr>
            ))}
            {diff.entries.every((e) => e.kind === 'same') && (
              <tr>
                <td colSpan={6} style={{ padding: 48, textAlign: 'center', color: 'var(--c-text-dim)', fontStyle: 'italic' }}>
                  No differences. {compareRev.code} and {current.code} are equivalent.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </TableScrollX>
    </div>
  )
}

function fmt(v: unknown): string {
  if (v == null) return '—'
  if (typeof v === 'number') return Number(v).toLocaleString('en-ZA', { maximumFractionDigits: 4 })
  return String(v)
}

function BackLink({
  projectId, revisionId, code, projectName,
}: { projectId: string; revisionId: string; code: string; projectName: string }) {
  return (
    <div style={{ marginBottom: 16 }}>
      <Link
        href={`/projects/${projectId}/cables/${revisionId}`}
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11,
          color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
        }}
      >
        ← {code} · {projectName}
      </Link>
    </div>
  )
}

function CompareSelector({
  basePath, current, revisions,
}: {
  basePath: string
  current: string
  revisions: { id: string; code: string; status: string }[]
}) {
  return (
    <form style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
        Compare against:
      </span>
      <select
        defaultValue={current}
        onChange={(e) => { window.location.href = `${basePath}?vs=${e.target.value}` }}
        className="ob-input"
        style={{ width: 160 }}
      >
        {revisions.map((r) => (
          <option key={r.id} value={r.id}>{r.code} ({r.status})</option>
        ))}
      </select>
    </form>
  )
}

function Th({ children, align, w }: { children?: React.ReactNode; align?: 'left' | 'right'; w?: number }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontSize: 9, letterSpacing: '0.08em', textTransform: 'uppercase',
      color: 'var(--c-text-dim)', fontWeight: 600, whiteSpace: 'nowrap',
      width: w,
    }}>{children}</th>
  )
}

function Td({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'top',
      color: 'var(--c-text)', whiteSpace: align === 'right' ? 'nowrap' : 'normal',
    }}>{children}</td>
  )
}
