'use server'

/**
 * tenant-bo.actions.ts — server actions for beneficial-occupation (BO) tracking.
 *
 * Covers:
 *   - setProjectOpeningDateAction — set / clear projects.projects.opening_date
 *   - setTenantBoAction           — set / clear bo_period_days and
 *                                   bo_date_override on structure.tenant_details
 *
 * Design spec: SPEC DOCS/2026-05-21-tenant-bo-dates-design.md.
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha):
 *   supabase-js `.schema(...)` silently strips the service-role auth header on
 *   writes → RLS denies. Writes here use a raw fetch to PostgREST with the
 *   Content-Profile header + the service-role key. Reads go through the
 *   cookie-authenticated supabase-js client.
 *
 * Authorisation: every action checks the caller is authenticated, can see the
 *   project, AND holds an owner / admin / project_manager role in the project's
 *   org — the roles the projects / tenant_details RLS write policies require.
 *   The check is enforced here because the writes run as service_role, which
 *   bypasses RLS.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()
const isoDateSchema = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Expected a YYYY-MM-DD date')

const WRITE_ROLES = ['owner', 'admin', 'project_manager'] as const

// ---------------------------------------------------------------------------
// PostgREST raw-fetch helpers (cross-schema write gotcha)
// ---------------------------------------------------------------------------

function restHeaders(serviceKey: string, profile: string, prefer: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': profile,
    Prefer: prefer,
  }
}

async function restPatch(
  supabaseUrl: string,
  serviceKey: string,
  profile: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: restHeaders(serviceKey, profile, 'return=minimal'),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH ${profile}.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Auth + role guard
// ---------------------------------------------------------------------------

type GuardResult =
  | { error: string; supabase?: undefined; orgId?: undefined }
  | { error?: undefined; supabase: Awaited<ReturnType<typeof createClient>>; orgId: string }

/**
 * Verify the caller is authenticated, can see the project, and holds a
 * write-capable role in the project's organisation.
 */
async function guardWriter(projectId: string): Promise<GuardResult> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  let project: { organisation_id: string } | null
  try {
    project = (await projectService.getById(supabase as never, projectId)) as { organisation_id: string }
  } catch {
    project = null
  }
  if (!project) return { error: 'Project not found' }

  const orgId = project.organisation_id

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', orgId)
    .eq('is_active', true)
    .maybeSingle()

  const role = (membership as { role: string } | null)?.role
  if (!role || !WRITE_ROLES.includes(role as (typeof WRITE_ROLES)[number])) {
    return { error: 'You do not have permission to change beneficial-occupation dates.' }
  }

  return { supabase, orgId }
}

function serverEnv(): { supabaseUrl: string; serviceKey: string } | null {
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return null
  return { supabaseUrl, serviceKey }
}

function revalidateBoPaths(projectId: string): void {
  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  revalidatePath(`/projects/${projectId}/materials`)
}

// ---------------------------------------------------------------------------
// setProjectOpeningDateAction
// ---------------------------------------------------------------------------

export type SetProjectOpeningDateResult = { ok: true } | { error: string }

/**
 * Set or clear projects.projects.opening_date. Pass null to clear.
 */
export async function setProjectOpeningDateAction(
  projectId: string,
  openingDate: string | null,
): Promise<SetProjectOpeningDateResult> {
  const parsed = z
    .object({ projectId: uuidSchema, openingDate: isoDateSchema.nullable() })
    .safeParse({ projectId, openingDate })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardWriter(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  const result = await restPatch(
    env.supabaseUrl,
    env.serviceKey,
    'projects',
    'projects',
    `id=eq.${projectId}`,
    { opening_date: parsed.data.openingDate },
  )
  if (!result.ok) return { error: result.error ?? 'Failed to set the opening date' }

  revalidateBoPaths(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// setTenantBoAction
// ---------------------------------------------------------------------------

export type SetTenantBoResult = { ok: true } | { error: string }

const setTenantBoSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  boPeriodDays: z.number().int().positive().nullable().optional(),
  boDateOverride: isoDateSchema.nullable().optional(),
})

/**
 * Set BO fields on a tenant's structure.tenant_details row.
 *
 * `patch` carries only the fields being changed:
 *   - a value  → set it
 *   - null     → clear it
 *   - omitted  → leave it untouched
 *
 * Ensures the tenant_details row exists first — scope/layout may never have been
 * touched for this tenant, so the row may not yet exist.
 */
export async function setTenantBoAction(
  projectId: string,
  nodeId: string,
  patch: { boPeriodDays?: number | null; boDateOverride?: string | null },
): Promise<SetTenantBoResult> {
  const parsed = setTenantBoSchema.safeParse({ projectId, nodeId, ...patch })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardWriter(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Confirm the node is a tenant node in this project (RLS-gated cookie read —
  // reads via .schema() are safe; the cross-schema gotcha is writes-only).
  const { data: node } = await guard.supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .eq('kind', 'tenant_db')
    .maybeSingle()
  if (!node) return { error: 'Tenant not found' }

  // Build the DB patch — `undefined` skips a field, `null` clears it.
  const dbPatch: Record<string, unknown> = {}
  if (parsed.data.boPeriodDays !== undefined) dbPatch.bo_period_days = parsed.data.boPeriodDays
  if (parsed.data.boDateOverride !== undefined) dbPatch.bo_date_override = parsed.data.boDateOverride
  if (Object.keys(dbPatch).length === 0) return { ok: true }

  const env = serverEnv()
  if (!env) return { error: 'Server misconfigured' }

  // Ensure the tenant_details row exists (upsert-ignore on node_id).
  const ensureRes = await fetch(`${env.supabaseUrl}/rest/v1/tenant_details?on_conflict=node_id`, {
    method: 'POST',
    headers: restHeaders(env.serviceKey, 'structure', 'resolution=ignore-duplicates'),
    body: JSON.stringify({ node_id: nodeId }),
  })
  if (!ensureRes.ok) {
    const text = await ensureRes.text()
    return { error: `Failed to ensure tenant_details row (HTTP ${ensureRes.status}): ${text.slice(0, 200)}` }
  }

  const result = await restPatch(
    env.supabaseUrl,
    env.serviceKey,
    'structure',
    'tenant_details',
    `node_id=eq.${nodeId}`,
    dbPatch,
  )
  if (!result.ok) return { error: result.error ?? 'Failed to update beneficial-occupation dates' }

  revalidateBoPaths(projectId)
  return { ok: true }
}
