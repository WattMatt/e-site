import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, mvProtectionService, mvSignoffComplete, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { requireMvAccess } from '@/lib/mv-access'
import { KpiCard } from '@/components/ui/Card'
import { SandboxNotice } from '@/components/mv/SandboxNotice'
import { RevisionStatusBadge } from '../RevisionStatusBadge'
import { SignoffForm, type ExistingSignoff } from './SignoffForm'

export const metadata: Metadata = { title: 'MV study sign-off' }

// Per-request render — the sign-off row + gate status change as the engineer
// edits, and the action revalidates this path. Matches the fault page.
export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

export default async function MvSignoffPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // Same write-role gate as the sign-off action. Denied users bounce back to
  // the schedule (mirrors the fault / fault-sources pages).
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${projectId}/cables/${revisionId}`)

  // Per-user MV paywall (Phase 7). Server-side gate on every MV route; the
  // mv-unlock page itself is exempt.
  const { data: { user } } = await supabase.auth.getUser()
  if (user) await requireMvAccess(supabase, user.id, `/projects/${projectId}/cables/${revisionId}/mv-unlock`)

  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, code, status, project_id')
    .eq('id', revisionId)
    .eq('project_id', projectId)
    .single()
  if (!rev) notFound()

  // The persisted sign-off + whether this revision actually carries MV data
  // (fault_sources OR protection_devices) — the same condition the issue guard
  // (assertMvSignoffComplete) uses to decide whether sign-off is required.
  const [signoff, faultSourcesRes, devicesRes] = await Promise.all([
    mvProtectionService.getMvStudySignoff(supabase as never, revisionId).catch(() => null),
    (supabase as any)
      .schema('cable_schedule')
      .from('fault_sources')
      .select('id', { count: 'exact', head: true })
      .eq('revision_id', revisionId),
    (supabase as any)
      .schema('cable_schedule')
      .from('protection_devices')
      .select('id', { count: 'exact', head: true })
      .eq('revision_id', revisionId),
  ])

  const hasMvData = ((faultSourcesRes?.count ?? 0) + (devicesRes?.count ?? 0)) > 0
  const { complete } = mvSignoffComplete(signoff)

  const existing: ExistingSignoff = {
    prEngName: signoff?.prEngName ?? null,
    prEngEcsaReg: signoff?.prEngEcsaReg ?? null,
    curveManualRev: signoff?.curveManualRev ?? null,
    sourceDataConfirmed: signoff?.sourceDataConfirmed ?? false,
    validationPackRef: signoff?.validationPackRef ?? null,
  }

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
          ← {rev.code} schedule
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Study sign-off<RevisionStatusBadge status={rev.status} /></h1>
          <p className="page-subtitle">
            {rev.code} · the §9 gated-issue precondition — a complete Pr.Eng sign-off is required
            before a revision carrying MV data can be issued
          </p>
        </div>
        <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
          <KpiCard
            label="Ready to issue"
            value={complete ? 'Yes' : 'No'}
            sub={complete ? 'all gates satisfied' : 'gates outstanding'}
            variant={complete ? 'success' : 'warning'}
          />
        </div>
      </div>

      <SandboxNotice />

      {!hasMvData && (
        <div
          style={{
            padding: '10px 14px', marginBottom: 16, borderRadius: 6,
            background: 'var(--c-panel)', border: '1px solid var(--c-border)',
            fontSize: 12, color: 'var(--c-text-dim)',
          }}
        >
          This revision carries no MV data (no source impedances or protection devices) yet, so the
          sign-off is <strong>not required</strong> to issue it. Completing it here is still recorded.
        </div>
      )}

      <SignoffForm
        revisionId={revisionId}
        initial={existing}
        locked={rev.status !== 'DRAFT'}
      />
    </div>
  )
}
