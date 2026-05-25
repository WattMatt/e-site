/**
 * Cable-schedule role-gate helpers.
 *
 * The generic primitive `requireRole` now lives in `@/lib/auth/require-role`
 * (the canonical RBAC module). This file keeps the cable-schedule-specific
 * convenience wrapper `requireRoleForRevision` (which resolves the org id
 * from a revision id via the revisions → projects join) and re-exports the
 * primitive + role-group constants so existing import paths keep working.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import { ORG_WRITE_ROLES, type OrgRole } from '@esite/shared'

import {
  requireRole,
  type RequireRoleResult,
} from '@/lib/auth/require-role'

export { requireRole }
export type { OrgRole, RequireRoleResult }

/**
 * Convenience wrapper — resolves the revision's organisation_id via the
 * revisions → projects.projects.organisation_id chain, then enforces the
 * role check.
 */
export async function requireRoleForRevision(
  supabase: SupabaseClient,
  revisionId: string,
  allowedRoles: readonly OrgRole[],
): Promise<RequireRoleResult> {
  const { data: rev } = await (supabase as any)
    .schema('cable_schedule')
    .from('revisions')
    .select('project_id')
    .eq('id', revisionId)
    .maybeSingle()
  if (!rev) return { ok: false, error: 'Revision not found' }

  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', (rev as { project_id: string }).project_id)
    .maybeSingle()
  if (!project) return { ok: false, error: 'Project not found' }

  return await requireRole(
    supabase,
    (project as { organisation_id: string }).organisation_id,
    allowedRoles,
  )
}

/**
 * Common role groups for cable-schedule write actions.
 * Aliased to the canonical @esite/shared constants so there's a single
 * source of truth; names retained for call-site stability.
 */
export const ROLES_ENGINEER = ORG_WRITE_ROLES
// 'field_worker' removed — was never a DB-legal user_organisations.role and
// so was unreachable. Constant name retained for call-site stability.
export const ROLES_ENGINEER_AND_FIELD = ORG_WRITE_ROLES
