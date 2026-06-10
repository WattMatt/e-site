import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, mvProtectionService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { SandboxNotice } from '@/components/mv/SandboxNotice'
import { RevisionStatusBadge } from '../RevisionStatusBadge'
import { FaultSourcesManager } from './FaultSourcesManager'
import type { AttachOption, ExistingFaultSource } from './FaultSourceForm'

export const metadata: Metadata = { title: 'MV source impedances' }

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

export default async function FaultSourcesPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!rev) notFound()

  // Existing facets + the attachment points (revision sources + project nodes).
  const [faultSources, sourcesRes, nodesRes] = await Promise.all([
    mvProtectionService.listFaultSources(supabase as never, revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code, type')
      .eq('revision_id', revisionId)
      .order('code'),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code, kind')
      .eq('project_id', projectId)
      .is('deleted_at' as never, null)
      .order('code'),
  ])

  const sourceRows = (sourcesRes?.data ?? []) as Array<{ id: string; code: string; type: string }>
  const nodeRows = (nodesRes?.data ?? []) as Array<{ id: string; code: string; kind: string }>

  const attachOptions: AttachOption[] = [
    ...sourceRows.map((s) => ({ key: `source:${s.id}`, label: `⚡ ${s.code} (${s.type})` })),
    ...nodeRows.map((n) => ({ key: `node:${n.id}`, label: `🟦 ${n.code} (${n.kind})` })),
  ]
  const attachLabels: Record<string, string> = {}
  for (const s of sourceRows) attachLabels[`source:${s.id}`] = s.code
  for (const n of nodeRows) attachLabels[`node:${n.id}`] = n.code

  const existing: ExistingFaultSource[] = faultSources.map((f) => ({
    id: f.id,
    nodeId: f.nodeId,
    sourceId: f.sourceId,
    role: f.role,
    sscMva: f.sscMva,
    xrRatio: f.xrRatio,
    z0OverZ1: f.z0OverZ1,
    ukPct: f.ukPct,
    pkrW: f.pkrW,
    sRatedVa: f.sRatedVa,
    vectorGroup: f.vectorGroup,
    lvEarthingKind: f.lvEarthingKind,
    lvEarthingOhm: f.lvEarthingOhm,
    xdPct: f.xdPct,
    currentLimitFactor: f.currentLimitFactor,
  }))

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}/fault`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← MV fault study · {rev.code}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Source impedances<RevisionStatusBadge status={rev.status} /></h1>
          <p className="page-subtitle">
            {rev.code} · {existing.length} source{existing.length !== 1 ? 's' : ''} ·
            {' '}the grid / transformer / generator / inverter data the fault solve needs
          </p>
        </div>
      </div>

      <SandboxNotice />

      {attachOptions.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            🔌 No nodes or sources to attach impedances to yet.
            <div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 6 }}>
              Build the <strong>Structure</strong> (sources and boards) on the{' '}
              <Link href={`/projects/${projectId}/cables/${revisionId}`} style={{ color: 'var(--c-amber)' }}>schedule</Link>{' '}
              first, then return to enter each one&apos;s impedance.
            </div>
          </div>
        </div>
      ) : (
        <FaultSourcesManager
          revisionId={revisionId}
          sources={existing}
          attachOptions={attachOptions}
          attachLabels={attachLabels}
          locked={rev.status !== 'DRAFT'}
        />
      )}
    </div>
  )
}
