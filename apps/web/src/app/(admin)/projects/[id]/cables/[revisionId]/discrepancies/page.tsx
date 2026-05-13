import { notFound } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { DiscrepancyTable, type DiscRow } from './DiscrepancyTable'

export const metadata: Metadata = { title: 'Length discrepancy report' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

interface CableJoin {
  id: string
  cable_no: number
  size_mm2: number
  measured_length_m: number | null
  confirmed_length_m: number | null
  length_status: 'UNMEASURED' | 'MEASURED' | 'CONFIRMED' | 'DISCREPANCY'
  confirmed_length_method: string | null
  confirmed_length_at: string | null
  confirmed_length_by: string | null
  confirmation_notes: string | null
  supply: {
    id: string
    source?: { code: string } | null
    from_board?: { code: string } | null
    to_board?: { code: string } | null
  }
  verifier?: { full_name: string | null; email: string | null } | null
}

export default async function DiscrepancyReportPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!rev) notFound()

  // All cables with EITHER confirmed_length set + discrepancy
  // OR confirmed-pending (status MEASURED + confirmed_length_m IS NOT NULL)
  const { data: cables } = await (supabase as any)
    .schema('cable_schedule')
    .from('cables')
    .select(
      'id, cable_no, size_mm2, measured_length_m, confirmed_length_m, length_status, ' +
      'confirmed_length_method, confirmed_length_at, confirmed_length_by, confirmation_notes, ' +
      'supply:supplies!supply_id(id, source:sources!from_source_id(code), from_board:boards!from_board_id(code), to_board:boards!to_board_id(code)), ' +
      'verifier:profiles!confirmed_length_by(full_name, email)',
    )
    .eq('revision_id', revisionId)
    .not('confirmed_length_m', 'is', null)
    .order('cable_no')
  const list = (cables ?? []) as unknown as CableJoin[]

  const rows: DiscRow[] = list.map((c) => {
    const measured = c.measured_length_m == null ? null : Number(c.measured_length_m)
    const confirmed = c.confirmed_length_m == null ? null : Number(c.confirmed_length_m)
    const delta = measured != null && confirmed != null ? confirmed - measured : null
    const deltaPct = measured != null && measured > 0 && delta != null
      ? (delta / measured) * 100
      : null
    return {
      id: c.id,
      tag: `${c.supply.source?.code ?? c.supply.from_board?.code ?? '?'}-${c.supply.to_board?.code ?? '?'}-${c.size_mm2}-${c.cable_no}`,
      measured,
      confirmed,
      delta,
      deltaPct,
      method: c.confirmed_length_method,
      status: c.length_status,
      confirmedAt: c.confirmed_length_at,
      verifierName: c.verifier?.full_name ?? c.verifier?.email ?? null,
      reason: c.confirmation_notes,
    }
  })

  const discrepancies = rows.filter((r) => r.status === 'DISCREPANCY')
  const pending = rows.filter((r) => r.status === 'MEASURED' && r.confirmed != null)
  const accepted = rows.filter((r) => r.status === 'CONFIRMED')

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← {rev.code} · {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Length discrepancy report</h1>
          <p className="page-subtitle">
            {rev.code} ·{' '}
            <span style={{ color: '#dc2626' }}><strong>{discrepancies.length}</strong> over threshold</span> ·{' '}
            <span style={{ color: 'var(--c-amber)' }}><strong>{pending.length}</strong> pending sign-off</span> ·{' '}
            <span style={{ color: '#16a34a' }}><strong>{accepted.length}</strong> confirmed</span>
          </p>
        </div>
      </div>

      {rows.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            📐 No confirmed lengths yet. As site captures land, this report shows
            anything Δ&gt;10% or Δ&gt;5 m (whichever is larger).
          </div>
        </div>
      ) : (
        <DiscrepancyTable rows={rows} locked={rev.status !== 'DRAFT'} />
      )}
    </div>
  )
}
