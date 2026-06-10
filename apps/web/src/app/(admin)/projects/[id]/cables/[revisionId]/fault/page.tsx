import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, mvProtectionService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { Card, CardHeader, CardBody, KpiCard } from '@/components/ui/Card'
import { Badge } from '@/components/ui/Badge'
import { SandboxNotice } from '@/components/mv/SandboxNotice'
import { RevisionStatusBadge } from '../RevisionStatusBadge'
import { RunStudyButton } from './RunStudyButton'

export const metadata: Metadata = { title: 'MV fault study' }

// Per-request render — fault_results change when the study route runs, and the
// RunStudyButton revalidates this path. Matches the cost page's force-dynamic.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

const fmtKa = (v: number | null) => (v == null ? '—' : v.toFixed(2))
const fmtNum = (v: number | null, dp = 1) => (v == null ? '—' : v.toFixed(dp))

export default async function MvFaultStudyPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // MV study surface — same write-role gate as the actions/route that produce
  // the results. Denied users bounce back to the schedule (mirrors cost/page).
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id, fault_level_ka')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!rev) notFound()

  // Cached per-node fault results + the project's nodes (for code labels) +
  // study settings. Nodes are PROJECT-scoped (structure.nodes), same as the
  // workspace page. listFaultResults is empty until the study route has run.
  const [results, { data: nodesData }, settings] = await Promise.all([
    mvProtectionService.listFaultResults(supabase as never, revisionId),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code, kind')
      .eq('project_id', projectId)
      .is('deleted_at' as never, null),
    mvProtectionService.getMvStudySettings(supabase as never, revisionId).catch(() => null),
  ])

  const nodeById = new Map<string, { code: string; kind: string }>()
  for (const n of (nodesData ?? []) as Array<{ id: string; code: string; kind: string }>) {
    nodeById.set(n.id, { code: n.code, kind: n.kind })
  }
  const nodeLabel = (id: string) => nodeById.get(id)?.code ?? id.slice(0, 8)

  // Sort rows by node code so the table reads stably.
  const rows = [...results].sort((a, b) =>
    nodeLabel(a.nodeId).localeCompare(nodeLabel(b.nodeId), undefined, { numeric: true }),
  )

  // Network-wide KPI peaks/floors (the headline duties), ignoring null cells.
  const maxOf = (pick: (r: (typeof rows)[number]) => number | null): number | null => {
    const vals = rows.map(pick).filter((v): v is number => v != null)
    return vals.length ? Math.max(...vals) : null
  }
  const minOf = (pick: (r: (typeof rows)[number]) => number | null): number | null => {
    const vals = rows.map(pick).filter((v): v is number => v != null)
    return vals.length ? Math.min(...vals) : null
  }
  const ik3MaxPeak = maxOf((r) => r.ik3MaxKa)
  const ik3MinFloor = minOf((r) => r.ik3MinKa)
  const ipPeak = maxOf((r) => r.ipKa)
  const xrPeak = maxOf((r) => r.xrRatio)
  const ik1MaxPeak = maxOf((r) => r.ik1MaxKa)
  const ik1MinFloor = minOf((r) => r.ik1MinKa)
  const anyUnearthed = rows.some((r) => r.icAmps != null)

  const computedAt = rows.length
    ? rows.reduce<string | null>((acc, r) => (acc && acc > r.computedAt ? acc : r.computedAt), null)
    : null

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
          <h1 className="page-title">MV fault study<RevisionStatusBadge status={rev.status} /></h1>
          <p className="page-subtitle">
            {rev.code} · {rows.length} node{rows.length !== 1 ? 's' : ''} computed
            {computedAt && <> · last run {new Date(computedAt).toLocaleString('en-ZA')}</>}
            {settings && <> · c_max {settings.cMax} / c_min {settings.cMin} · {settings.baseMva} MVA base</>}
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/fault-sources`}
            style={{
              background: 'var(--c-panel)', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', borderRadius: 6, padding: '9px 16px',
              fontSize: 13, textDecoration: 'none',
            }}
          >
            🔌 Source impedances
          </Link>
          <RunStudyButton revisionId={revisionId} disabled={rev.status !== 'DRAFT'} hasResults={rows.length > 0} />
        </div>
      </div>

      <SandboxNotice />

      {rows.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            ⚡ No fault results yet.
            <div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 6 }}>
              Enter the <Link href={`/projects/${projectId}/cables/${revisionId}/fault-sources`} style={{ color: 'var(--c-amber)' }}>source impedances</Link>{' '}
              (utility S″k, transformer u<sub>k</sub>%, generator x″<sub>d</sub>), then press{' '}
              <strong>⚡ Run study</strong> to solve Z-bus fault levels for every node.
            </div>
          </div>
        </div>
      ) : (
        <>
          {/* Network-wide headline duties. */}
          <div className="kpi-grid" style={{ marginBottom: 20 }}>
            <KpiCard label="Ik3 max (peak)" value={`${fmtKa(ik3MaxPeak)} kA`} sub="3-phase, c_max — breaker breaking duty" variant="danger" />
            <KpiCard label="ip (peak)" value={`${fmtKa(ipPeak)} kA`} sub="peak make current κ·√2·Ik3" variant="warning" />
            <KpiCard label="X/R (peak)" value={fmtNum(xrPeak, 1)} sub="asymmetry — flags > 14.1" />
            <KpiCard label="Ik3 min (floor)" value={`${fmtKa(ik3MinFloor)} kA`} sub="3-phase, c_min, motors excluded" />
            <KpiCard label="Ik1 max (peak)" value={`${fmtKa(ik1MaxPeak)} kA`} sub="SLG earth fault, c_max" variant="danger" />
            <KpiCard label="Ik1 min (floor)" value={`${fmtKa(ik1MinFloor)} kA`} sub="SLG earth fault, EF sensitivity" />
          </div>

          <Card>
            <CardHeader>
              <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text-mid)' }}>Per-node fault levels</span>
              {anyUnearthed && (
                <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 8 }}>
                  i<sub>c</sub> shown for unearthed buses (capacitive earth-fault current)
                </span>
              )}
            </CardHeader>
            <CardBody>
              <div style={{ overflowX: 'auto' }}>
                <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
                  <thead>
                    <tr style={{ background: 'var(--c-base)' }}>
                      <Th>Node</Th>
                      <Th align="right">Ik3 max (kA)</Th>
                      <Th align="right">Ik3 min (kA)</Th>
                      <Th align="right">X/R</Th>
                      <Th align="right">ip (kA)</Th>
                      <Th align="right">Ik1 max (kA)</Th>
                      <Th align="right">Ik1 min (kA)</Th>
                      <Th align="right">i_c (A)</Th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={r.nodeId} style={{ borderTop: '1px solid var(--c-border)' }}>
                        <Td><strong>{nodeLabel(r.nodeId)}</strong>{' '}
                          <span style={{ color: 'var(--c-text-dim)', fontSize: 11 }}>{nodeById.get(r.nodeId)?.kind ?? ''}</span>
                        </Td>
                        <Td align="right" mono>{fmtKa(r.ik3MaxKa)}</Td>
                        <Td align="right" mono>{fmtKa(r.ik3MinKa)}</Td>
                        <Td align="right" mono style={r.xrRatio != null && r.xrRatio > 14.1 ? { color: 'var(--c-amber)' } : undefined}>
                          {fmtNum(r.xrRatio, 1)}
                        </Td>
                        <Td align="right" mono>{fmtKa(r.ipKa)}</Td>
                        <Td align="right" mono>{fmtKa(r.ik1MaxKa)}</Td>
                        <Td align="right" mono>{fmtKa(r.ik1MinKa)}</Td>
                        <Td align="right" mono>{r.icAmps == null ? '—' : r.icAmps.toFixed(1)}</Td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardBody>
          </Card>
        </>
      )}
    </div>
  )
}

function Th({ children, align }: { children?: React.ReactNode; align?: 'left' | 'right' }) {
  return (
    <th style={{
      textAlign: align ?? 'left', padding: '10px 12px',
      fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.08em',
      textTransform: 'uppercase', color: 'var(--c-text-dim)',
      fontWeight: 600, whiteSpace: 'nowrap',
    }}>{children}</th>
  )
}

function Td({
  children, align, mono, style,
}: {
  children?: React.ReactNode
  align?: 'left' | 'right' | 'center'
  mono?: boolean
  style?: React.CSSProperties
}) {
  return (
    <td style={{
      textAlign: align ?? 'left', padding: '8px 12px', verticalAlign: 'middle',
      fontFamily: mono ? 'var(--font-mono)' : undefined,
      fontSize: 12, color: 'var(--c-text)', whiteSpace: 'nowrap',
      ...style,
    }}>{children}</td>
  )
}
