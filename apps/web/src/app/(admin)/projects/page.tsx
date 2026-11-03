import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, formatDate, formatZAR, ORG_WRITE_ROLES, type OrgRole } from '@esite/shared'
import { loadRoleMaps, costVisibilityFrom } from '@/lib/projects/cost-visibility'
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

  // Per-row cost visibility (owner/admin/PM in the project's org, or a COST_VIEW_ROLES
  // project-member role). The rule lives in lib/projects/cost-visibility.ts, shared with
  // the MCP tools. The org-role map is kept because canCreateProject reads it below.
  const { orgRoleByOrgId, projectRoleByProject } = user
    ? await loadRoleMaps(supabase, user.id)
    : { orgRoleByOrgId: new Map<string, string>(), projectRoleByProject: new Map<string, string>() }
  const canSeeCostFor = costVisibilityFrom({ orgRoleByOrgId, projectRoleByProject })

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

  // Only owner/admin/PM create projects (site-scoped access, 00238).
  const canCreateProject = [...orgRoleByOrgId.values()].some((r) => ORG_WRITE_ROLES.includes(r as OrgRole))

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Projects</h1>
          <p className="page-subtitle">{projects.length} project{projects.length !== 1 ? 's' : ''}</p>
        </div>
        {canCreateProject && <Link href="/projects/new" className="btn-primary-amber">+ New Project</Link>}
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
