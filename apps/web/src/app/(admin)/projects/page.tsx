import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, formatDate, formatZAR, COST_VIEW_ROLES } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { FolderOpen } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Projects' }

const statusBadge = (s: string) => ({
  active:    'badge badge-green',
  completed: 'badge badge-blue',
  on_hold:   'badge badge-amber',
  cancelled: 'badge badge-muted',
}[s] ?? 'badge badge-muted')

export default async function ProjectsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const projects = membership
    ? await projectService.list(supabase as any, membership.organisation_id)
    : []

  const canSeeCost = membership
    ? await requireRole(supabase, membership.organisation_id, COST_VIEW_ROLES).then(
        (g) => g.ok,
      )
    : false

  // Per-project inspections certified count (replaces compliance-health %)
  const projectIds = projects.map((p: any) => p.id)
  const inspectionCounts: Record<string, { total: number; certified: number }> = {}
  if (projectIds.length > 0) {
    const [totalsRes, certifiedRes] = await Promise.all([
      supabase.schema('inspections').from('inspections')
        .select('project_id')
        .in('project_id', projectIds),
      supabase.schema('inspections').from('inspections')
        .select('project_id')
        .in('project_id', projectIds)
        .eq('status', 'certified'),
    ])
    for (const id of projectIds) inspectionCounts[id] = { total: 0, certified: 0 }
    for (const row of (totalsRes.data ?? []) as Array<{ project_id: string }>) {
      if (inspectionCounts[row.project_id]) inspectionCounts[row.project_id].total += 1
    }
    for (const row of (certifiedRes.data ?? []) as Array<{ project_id: string }>) {
      if (inspectionCounts[row.project_id]) inspectionCounts[row.project_id].certified += 1
    }
  }

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        <Link href="/projects/new" className="btn-primary-amber">+ New Project</Link>
      </div>

      {projects.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '64px 18px' }}>
            <FolderOpen size={28} style={{ margin: '0 auto 12px', opacity: 0.25, display: 'block' }} />
            No projects yet — create your first to start tracking snags, RFIs and compliance.
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">All Projects</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {projects.length} total
            </span>
          </div>
          {projects.map((project) => {
            const counts = inspectionCounts[project.id] ?? { total: 0, certified: 0 }
            return (
              <Link key={project.id} href={`/projects/${project.id}`} className="data-panel-row">
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>{project.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {project.client_name ?? '—'}
                    {project.city ? ` · ${project.city}${project.province ? `, ${project.province}` : ''}` : ''}
                    {` · ${formatDate(project.created_at)}`}
                  </div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexShrink: 0 }}>
                  {counts.total > 0 && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
                      {counts.certified} of {counts.total} certified
                    </span>
                  )}
                  {canSeeCost && project.contract_value != null && (
                    <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, fontWeight: 700, color: 'var(--c-text-mid)' }}>
                      {formatZAR(project.contract_value)}
                    </span>
                  )}
                  <span className={statusBadge(project.status)}>{project.status.replace('_', ' ')}</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
