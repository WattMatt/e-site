/**
 * Canonical RBAC helpers.
 *
 * Three entry points, one source of truth for "is this user allowed":
 *
 * - requireRole(supabase, orgId, allowedRoles) — primitive. Takes an explicit
 *   supabase client + org id, returns { ok, role } | { ok: false, error }.
 *   Use from server actions that already hold a supabase client and an org id
 *   resolved from a domain entity (revision, project, etc.).
 *
 * - requireRoleAPI(allowedRoles, orgId?) — for route handlers. Returns either
 *   { ok: true, ctx, user } or { ok: false, response } where response is a
 *   ready-to-return NextResponse (401/400/403). If orgId is omitted, falls
 *   back to the caller's primary org.
 *
 * - requireRolePage(allowedRoles, opts?) — for server-rendered pages. Returns
 *   OrgContext on success, or calls Next's redirect() (which throws) on
 *   failure. Default redirect target is /dashboard.
 *
 * Org-resolution rules:
 *   - The API + page helpers resolve the user's *primary* org via getOrgContext
 *     (oldest active membership). Single-org users — the common case — see
 *     the obvious behaviour; multi-org user behaviour is a known limitation
 *     tracked separately.
 *   - The primitive form accepts an explicit orgId so callers acting on a
 *     specific entity (e.g. a revision belonging to org X) can enforce against
 *     that org, not whichever happens to be primary.
 */

import { NextResponse } from 'next/server'
import { redirect } from 'next/navigation'
import type { SupabaseClient, User } from '@supabase/supabase-js'
import type { OrgRole } from '@esite/shared'

import { createClient } from '@/lib/supabase/server'
import { getOrgContext, type OrgContext } from '@/lib/auth-org'

export type { OrgRole }

export type RequireRoleResult =
  | { ok: true;  role: OrgRole }
  | { ok: false; error: string }

/**
 * Primitive: confirm the caller is an active member of `organisationId` with
 * one of the allowed roles. Caller supplies the supabase client and org id.
 */
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

export type RequireRoleAPIResult =
  | { ok: true;  ctx: OrgContext; user: User }
  | { ok: false; response: NextResponse }

/**
 * For API route handlers. Confirms the caller is authenticated and holds one
 * of `allowedRoles` on the relevant organisation.
 *
 * If `organisationId` is omitted, the caller's *primary* org (oldest active
 * membership) is used — the common case for endpoints that operate on a user's
 * own org context (e.g. checkout, settings mutations). Pass an explicit id
 * for endpoints that act on a specific entity whose org id has been resolved
 * from a path param or domain join.
 *
 * Returns:
 * - 401 when no session
 * - 400 when no organisation can be resolved (primary-org case only)
 * - 403 when membership exists but the role is not in `allowedRoles`
 *
 * Usage:
 *   const guard = await requireRoleAPI(OWNER_ADMIN)
 *   if (!guard.ok) return guard.response
 *   const { organisationId, role } = guard.ctx
 */
export async function requireRoleAPI(
  allowedRoles: readonly OrgRole[],
  organisationId?: string,
): Promise<RequireRoleAPIResult> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return jsonErr(401, 'Not authenticated')

  if (organisationId) {
    const result = await requireRole(supabase, organisationId, allowedRoles)
    if (!result.ok) {
      const status = result.error === 'Not authenticated' ? 401 : 403
      return jsonErr(status, result.error)
    }
    return { ok: true, ctx: { userId: user.id, organisationId, role: result.role }, user }
  }

  const ctx = await getOrgContext()
  if (!ctx) return jsonErr(400, 'No organisation found')
  if (!allowedRoles.includes(ctx.role)) {
    return jsonErr(403, `Your role (${ctx.role}) is not allowed to perform this action`)
  }
  return { ok: true, ctx, user }
}

function jsonErr(status: number, error: string): RequireRoleAPIResult {
  return { ok: false, response: NextResponse.json({ error }, { status }) }
}

export interface RequireRolePageOptions {
  /** Where to send users whose role isn't allowed. Default: /dashboard. */
  redirectTo?: string
  /** Where to send unauthenticated users. Default: /login. */
  loginPath?: string
}

/**
 * For server-rendered pages. Resolves the caller's primary org context and
 * enforces the role gate. Calls redirect() (which throws) on failure — the
 * caller never sees an unauthorised path render.
 */
export async function requireRolePage(
  allowedRoles: readonly OrgRole[],
  opts: RequireRolePageOptions = {},
): Promise<OrgContext> {
  const ctx = await getOrgContext()
  if (!ctx) {
    redirect(opts.loginPath ?? '/login')
  }
  if (!allowedRoles.includes(ctx.role)) {
    redirect(opts.redirectTo ?? '/dashboard')
  }
  return ctx
}
