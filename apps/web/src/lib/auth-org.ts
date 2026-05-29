import { createClient } from '@/lib/supabase/server'
import type { OrgRole } from '@esite/shared'

/**
 * The caller's active organisation membership, resolved from the cookie-bound
 * session. Safe to use in RSC pages and server actions.
 */
export interface OrgContext {
  userId:         string
  organisationId: string
  role:           OrgRole
}

/**
 * Resolve the signed-in user's active org membership.
 *
 * Resolution order:
 *  1. profiles.active_organisation_id (set by OrgSwitcher via setActiveOrganisation)
 *     — only used if the user still has an active membership in that org.
 *  2. Oldest active user_organisations row (previous behaviour, fallback for
 *     single-org users and any case where active_organisation_id is NULL or stale).
 *
 * Returns null when not authenticated or not a member of any organisation.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  // Step 1 — check for an explicitly chosen org context.
  const { data: profile } = await (supabase as any)
    .from('profiles')
    .select('active_organisation_id')
    .eq('id', user.id)
    .maybeSingle()
  const activeOrgId = (profile as { active_organisation_id?: string | null } | null)?.active_organisation_id ?? null

  if (activeOrgId) {
    const { data: activeMembership } = await (supabase as any)
      .from('user_organisations')
      .select('organisation_id, role')
      .eq('user_id', user.id)
      .eq('organisation_id', activeOrgId)
      .eq('is_active', true)
      .maybeSingle()
    if (activeMembership) {
      return {
        userId:         user.id,
        organisationId: (activeMembership as any).organisation_id as string,
        role:           (activeMembership as any).role as OrgRole,
      }
    }
  }

  // Step 2 — fall back to oldest active membership (single-org users always land here).
  const { data } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  if (!data) return null

  return {
    userId:         user.id,
    organisationId: data.organisation_id,
    role:           data.role as OrgRole,
  }
}

/** True when the role may manage organisation users (create / edit / remove). */
export function isOrgAdmin(role: OrgRole): boolean {
  return role === 'owner' || role === 'admin'
}
