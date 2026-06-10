import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, mvProtectionService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { SandboxNotice } from '@/components/mv/SandboxNotice'
import { RevisionStatusBadge } from '../RevisionStatusBadge'
import { ProtectionDevicesManager } from './ProtectionDevicesManager'
import type { AttachOption, ExistingDevice } from './ProtectionDeviceForm'

export const metadata: Metadata = { title: 'MV protection devices' }

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

export default async function ProtectionDevicesPage({ params }: Props) {
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

  // Devices + attachment points: project nodes + revision supplies (with their
  // from/to node codes for a readable feeder label). Sources/nodes resolve the
  // supply endpoints in JS (cross-schema embeds aren't possible).
  const [devices, suppliesRes, sourcesRes, nodesRes] = await Promise.all([
    mvProtectionService.listProtectionDevices(supabase as never, revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('supplies')
      .select('id, from_source_id, from_node_id, to_node_id')
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('sources')
      .select('id, code')
      .eq('revision_id', revisionId),
    supabase
      .schema('structure')
      .from('nodes')
      .select('id, code, kind')
      .eq('project_id', projectId)
      .is('deleted_at' as never, null)
      .order('code'),
  ])

  const supplyRows = (suppliesRes?.data ?? []) as Array<{
    id: string; from_source_id: string | null; from_node_id: string | null; to_node_id: string
  }>
  const nodeRows = (nodesRes?.data ?? []) as Array<{ id: string; code: string; kind: string }>

  const codeById = new Map<string, string>()
  for (const s of (sourcesRes?.data ?? []) as Array<{ id: string; code: string }>) codeById.set(s.id, s.code)
  for (const n of nodeRows) codeById.set(n.id, n.code)
  const code = (id: string | null) => (id && codeById.get(id)) || '?'

  const attachOptions: AttachOption[] = [
    ...nodeRows.map((n) => ({ key: `node:${n.id}`, label: `🟦 ${n.code} (${n.kind})` })),
    ...supplyRows.map((s) => ({
      key: `supply:${s.id}`,
      label: `─ ${code(s.from_source_id ?? s.from_node_id)} → ${code(s.to_node_id)}`,
    })),
  ]
  const attachLabels: Record<string, string> = {}
  for (const n of nodeRows) attachLabels[`node:${n.id}`] = n.code
  for (const s of supplyRows) {
    attachLabels[`supply:${s.id}`] = `${code(s.from_source_id ?? s.from_node_id)}→${code(s.to_node_id)}`
  }

  const existing: ExistingDevice[] = devices.map((d) => ({
    id: d.id,
    nodeId: d.nodeId,
    supplyId: d.supplyId,
    deviceRole: d.deviceRole,
    deviceType: d.deviceType,
    manufacturer: d.manufacturer,
    model: d.model,
    frameRatingA: d.frameRatingA,
    curveRef: d.curveRef,
    settings: d.settings,
  }))

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
          <h1 className="page-title">Protection devices<RevisionStatusBadge status={rev.status} /></h1>
          <p className="page-subtitle">
            {rev.code} · {existing.length} device{existing.length !== 1 ? 's' : ''} ·
            {' '}relays / breakers / fuses + their parametric IEC/IEEE curves
          </p>
        </div>
        <div style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
          <Link
            href={`/projects/${projectId}/cables/${revisionId}/coordination`}
            style={{
              background: 'var(--c-panel)', border: '1px solid var(--c-border)',
              color: 'var(--c-text-mid)', borderRadius: 6, padding: '9px 16px',
              fontSize: 13, textDecoration: 'none',
            }}
          >
            📈 Coordination
          </Link>
        </div>
      </div>

      <SandboxNotice />

      {attachOptions.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px', textAlign: 'center' }}>
            🛡 No nodes or feeders to protect yet.
            <div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 6 }}>
              Build the <strong>Structure</strong> on the{' '}
              <Link href={`/projects/${projectId}/cables/${revisionId}`} style={{ color: 'var(--c-amber)' }}>schedule</Link>{' '}
              first, then add a device for each protected point.
            </div>
          </div>
        </div>
      ) : (
        <ProtectionDevicesManager
          revisionId={revisionId}
          devices={existing}
          attachOptions={attachOptions}
          attachLabels={attachLabels}
          locked={rev.status !== 'DRAFT'}
        />
      )}
    </div>
  )
}
