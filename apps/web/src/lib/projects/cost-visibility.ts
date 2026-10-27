import type { SupabaseClient } from '@supabase/supabase-js'
import { COST_VIEW_ROLES } from '@esite/shared'

export type CostVisibilityProject = { id: string; organisation_id: string }

export type RoleMaps = {
  /** organisation_id -> the caller's org role (active memberships only) */
  orgRoleByOrgId: Map<string, string>
  /** project_id -> the caller's project-member role (active rows only) */
  projectRoleByProject: Map<string, string>
}

/**
 * The caller's active org roles and project-member roles, read through their own session.
 * Lifted unchanged from the /projects page so the page and the MCP tools agree.
 */
export async function loadRoleMaps(client: SupabaseClient<any, any, any>, userId: string): Promise<RoleMaps> {
  const projectRoleByProject = new Map<string, string>()
  const orgRoleByOrgId = new Map<string, string>()

  // All active org memberships for this user (one row for single-org users,
  // multiple for cross-org). Builds orgRoleByOrgId used in the per-row check.
  const { data: orgRows } = await client
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', userId)
    .eq('is_active', true)
  for (const r of (orgRows ?? []) as Array<{ organisation_id: string; role: string }>) {
    orgRoleByOrgId.set(r.organisation_id, r.role)
  }

  // Project-member roles for this user across all projects.
  // Used for sub-org users who may be promoted to a cost-view role on a specific project.
  const { data: pmRows } = await client
    .schema('projects')
    .from('project_members')
    .select('project_id, role')
    .eq('user_id', userId)
    .eq('is_active', true)
  for (const r of (pmRows ?? []) as Array<{ project_id: string; role: string }>) {
    projectRoleByProject.set(r.project_id, r.role)
  }

  return { orgRoleByOrgId, projectRoleByProject }
}

/**
 * Per-row cost visibility: a user can see cost if they are owner/admin/PM in
 * THAT project's org, OR if they hold a COST_VIEW_ROLES project-member role.
 * For cross-org sub-org users, only the project_members path will fire.
 */
export function costVisibilityFrom(maps: RoleMaps): (p: CostVisibilityProject) => boolean {
  return (p) => {
    // Check project's own org first (WM users with owner/admin/PM role).
    const orgRole = maps.orgRoleByOrgId.get(p.organisation_id)
    if (orgRole != null && (COST_VIEW_ROLES as readonly string[]).includes(orgRole)) return true
    // Fall through to per-project role (sub-org users promoted to PM on the project).
    const pmRole = maps.projectRoleByProject.get(p.id)
    return pmRole != null && (COST_VIEW_ROLES as readonly string[]).includes(pmRole)
  }
}

/** `projects` is accepted for call-site symmetry; the maps cover every project the caller belongs to. */
export async function loadCostVisibility(
  client: SupabaseClient<any, any, any>,
  userId: string,
  _projects: CostVisibilityProject[],
): Promise<(p: CostVisibilityProject) => boolean> {
  return costVisibilityFrom(await loadRoleMaps(client, userId))
}
