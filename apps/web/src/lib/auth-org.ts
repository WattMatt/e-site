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
 * Resolve the signed-in user's active org membership (oldest, if several).
 * Returns null when not authenticated or not a member of any organisation.
 */
export async function getOrgContext(): Promise<OrgContext | null> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

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
