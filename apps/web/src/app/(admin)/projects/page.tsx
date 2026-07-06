import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, formatDate, formatZAR, COST_VIEW_ROLES } from '@esite/shared'
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

  // Cross-org list: RLS gates access, no org_id filter needed.
  // Sub-org users (e.g. Mike from Bob's Building) see projects they've been
  // added to via project_members even though they have no row in the project's
  // org — enabled by the additive user_has_project_access SELECT policy in
  // migration 00160 (before it, the org-scoped 00034 policy hid these rows).
  const projects = user
    ? await projectService.listAccessible(supabase as any)
    : []

  // Per-row cost visibility: a user can see cost if they are owner/admin/PM in
  // THAT project's org, OR if they hold a COST_VIEW_ROLES project-member role.
  // For cross-org sub-org users, only the project_members path will fire.
  const projectRoleByProject = new Map<string, string>()
  const orgRoleByOrgId       = new Map<string, string>()
  if (user) {
    // All active org memberships for this user (one row for single-org users,
    // multiple for cross-org). Builds orgRoleByOrgId used in per-row check.
    const { data: orgRows } = await supabase
      .from('user_organisations')
      .select('organisation_id, role')
      .eq('user_id', user.id)
      .eq('is_active', true)
    for (const r of (orgRows ?? []) as Array<{ organisation_id: string; role: string }>) {
      orgRoleByOrgId.set(r.organisation_id, r.role)
    }

    // Project-member roles for this user across all projects.
    // Used for sub-org users who may be promoted to a cost-view role on a specific project.
    const { data: pmRows } = await (supabase as any)
      .schema('projects')
      .from('project_members')
      .select('project_id, role')
      .eq('user_id', user.id)
      .eq('is_active', true)
    for (const r of (pmRows ?? []) as Array<{ project_id: string; role: string }>) {
      projectRoleByProject.set(r.project_id, r.role)
    }
  }

  const canSeeCostFor = (p: { id: string; organisation_id: string }): boolean => {
    // Check project's own org first (WM users with owner/admin/PM role).
    const orgRole = orgRoleByOrgId.get(p.organisation_id)
    if (orgRole != null && (COST_VIEW_ROLES as readonly string[]).includes(orgRole)) return true
    // Fall through to per-project role (sub-org users promoted to PM on the project).
    const pmRole = projectRoleByProject.get(p.id)
    return pmRole != null && (COST_VIEW_ROLES as readonly string[]).includes(pmRole)
  }

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
                  {canSeeCostFor(project) && project.contract_value != null && (
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
