/**
 * Shared role-gate helper for cable-schedule write actions (C12).
 *
 * Reads the user's role from user_organisations directly (bypassing
 * lookupCableRole which silently coerces unknowns to 'Viewer' — a
 * false-positive risk per the same pattern in export-role.ts).
 *
 * Returns:
 * - { ok: true, role } when the user is an active member with one of the
 *   allowed roles for this organisation
 * - { ok: false, error } when not authenticated, not a member, or role
 *   not in the allowed list
 *
 * Caller is responsible for resolving the organisation_id from the
 * revision / project / entity being modified. Most cable-schedule write
 * actions take a revisionId; use requireRoleForRevision(supabase, revisionId)
 * below as a one-liner.
 */

import type { SupabaseClient } from '@supabase/supabase-js'
import type { OrgRole } from '@esite/shared'

// OrgRole — canonical shared vocabulary (packages/shared/src/types). Re-exported
// so existing cable-schedule importers keep their import path.
export type { OrgRole }

export type RequireRoleResult =
  | { ok: true; role: OrgRole }
  | { ok: false; error: string }

export async function requireRole(
  supabase: SupabaseClient,
  organisationId: string,
  allowedRoles: readonly OrgRole[],
): Promise<RequireRoleResult> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated' }

  const { data: row } = await (supabase as any)
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', organisationId)
    .eq('is_active', true)
    .maybeSingle()

  const role = (row as { role?: OrgRole } | null)?.role
  if (!role) return { ok: false, error: 'Not a member of this organisation' }
  if (!allowedRoles.includes(role)) {
    return { ok: false, error: `Your role (${role}) is not allowed to perform this action` }
  }

  return { ok: true, role }
}

/**
 * Convenience wrapper — resolves the revision's organisation_id via the
 * revisions → projects.projects.organisation_id chain, then enforces
 * the role check.
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

/** Common role groups for write actions */
export const ROLES_ENGINEER = ['owner', 'admin', 'project_manager'] as const satisfies readonly OrgRole[]
// 'field_worker' removed — it was never a DB-legal user_organisations.role and
// so was unreachable. Constant name retained for call-site stability.
export const ROLES_ENGINEER_AND_FIELD = ['owner', 'admin', 'project_manager'] as const satisfies readonly OrgRole[]
