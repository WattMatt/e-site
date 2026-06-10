import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, ORG_WRITE_ROLES } from '@esite/shared'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { Card, CardBody } from '@/components/ui/Card'

export const metadata: Metadata = { title: 'Medium Voltage' }

export const dynamic = 'force-dynamic'

interface Props {
  params: Promise<{ id: string }>
}

/**
 * Section entry for the Medium Voltage module (sidebar target). The MV study
 * is a facet of cable_schedule.revisions, so this resolves the project's
 * "current" revision — the DRAFT if one exists, else the most recent ISSUED —
 * and redirects into its fault study. With no revisions at all it renders an
 * empty state pointing at the cable schedule (where revisions are created).
 */
export default async function MediumVoltagePage({ params }: Props) {
  const { id: projectId } = await params
  const supabase = await createClient()

  const project = await projectService
    .getById(supabase as never, projectId)
    .catch(() => null)
  if (!project) notFound()

  // Same write-role gate as the five MV pages. Denied users bounce back to
  // the project overview (no revision context to land on here).
  const guard = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!guard.ok) redirect(`/projects/${projectId}`)

  // Current revision: the DRAFT for the project if one exists, else the most
  // recent ISSUED (created_at desc). SUPERSEDED revisions never win.
  const { data: revisions } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('id, status, created_at')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })

  const rows = (revisions ?? []) as Array<{ id: string; status: string; created_at: string }>
  const current = rows.find((r) => r.status === 'DRAFT') ?? rows.find((r) => r.status === 'ISSUED')

  if (current) redirect(`/projects/${projectId}/medium-voltage/${current.id}/fault`)

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">⚡ Medium Voltage</h1>
          <p className="page-subtitle">
            {project.name} · fault, protection &amp; coordination studies
          </p>
        </div>
      </div>

      <Card>
        <CardBody>
          <div style={{ padding: '32px 18px', textAlign: 'center', fontSize: 13, color: 'var(--c-text-mid)' }}>
            The MV study works on a cable schedule revision, and this project has none yet.
            <div style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 8 }}>
              Create a revision on the{' '}
              <Link href={`/projects/${projectId}/cables`} style={{ color: 'var(--c-amber)' }}>cable schedule</Link>{' '}
              first, then return here to run the fault study.
            </div>
          </div>
        </CardBody>
      </Card>
    </div>
  )
}
