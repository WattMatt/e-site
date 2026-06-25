'use server'

/**
 * tenant-scope.actions.ts — server actions for scope-of-work tracking.
 *
 * Covers:
 *   - setScopeItemPartyAction    — set Landlord/Tenant for a (node, scope_item_type) pair
 *   - setScopeNotRequiredAction  — landlord-covers-full-scope override (no doc will issue)
 *   - addScopeItemTypeAction     — add a new org-level scope item type to the registry
 *
 * Note: setScopeStatusAction and setLayoutStatusAction were removed — status is
 * auto-derived by the 00118 DB trigger from document/revision presence (spec §3.3).
 * setScopeNotRequiredAction is NOT that toggle: it writes a separate, orthogonal
 * column (scope_not_required, migration 00150) the trigger never touches.
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha):
 *   supabase-js `.schema('structure').from(...).insert()` silently strips the
 *   service-role auth header → RLS denies. All writes to structure.* tables use
 *   raw fetch to PostgREST with Content-Profile: structure + service-role key.
 *   Reads go through the cookie-authenticated supabase-js client as normal.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { requireEffectiveRole } from '@/lib/auth/require-role'
import { projectService, deriveTenantNodeOrder, planTenantOrderReconcile, ORG_WRITE_ROLES } from '@esite/shared'
import type { NodeOrderStatus } from '@esite/shared'

// ---------------------------------------------------------------------------
// Shared helpers — mirror the commit route's structureHeaders / structurePatch
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=representation',
  }
}

async function structurePost(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
  queryString = '',
): Promise<{ ok: boolean; data?: unknown; error?: string }> {
  const url = `${supabaseUrl}/rest/v1/${table}${queryString ? `?${queryString}` : ''}`
  const res = await fetch(url, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true, data: await res.json() }
}

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

async function structureDelete(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'DELETE',
    headers: structureHeaders(serviceKey),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 400)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Auth + project-access guard
// ---------------------------------------------------------------------------

const uuidSchema = z.string().uuid()

/** Returns { user, orgId, supabase } or { error: string } */
async function guardProjectAccess(projectId: string): Promise<
  | { error: string; orgId?: undefined; supabase?: undefined }
  | { error?: undefined; user: object; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  // Writes here use the service-role key (bypasses RLS), so enforce the
  // owner/admin/project_manager write-role gate in app code. requireEffectiveRole
  // honours per-project promotion (user_effective_project_role / migration 00107).
  const roleGate = await requireEffectiveRole(supabase, projectId, ORG_WRITE_ROLES)
  if (!roleGate.ok) return { error: roleGate.error }

  return { user, orgId: project.organisation_id as string, supabase }
}

/**
 * Validate that nodeId belongs to projectId using the RLS-gated cookie client.
 * The cookie client is org-scoped via RLS, so a node outside the user's org
 * returns null even if the UUID is valid. Reads through .schema() are safe —
 * the cross-schema service-role gotcha applies to writes only.
 */
async function guardNodeBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: node } = await supabase
    .schema('structure')
    .from('nodes')
    .select('id')
    .eq('id', nodeId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!node) return { error: 'Node not found' }
  return null
}

// ---------------------------------------------------------------------------
// setScopeItemPartyAction
// ---------------------------------------------------------------------------

const setScopeItemPartySchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  scopeItemTypeId: uuidSchema,
  party: z.enum(['landlord', 'tenant']),
})

export type SetScopeItemPartyResult = { ok: true } | { error: string }

/**
 * Upsert a tenant_scope_items row for (nodeId, scopeItemTypeId) with the given party,
 * then reconcile the corresponding node_order (§3, §5).
 *
 * Node-order reconciliation uses a read-then-decide pattern rather than an unconditional
 * merge-duplicates upsert. merge-duplicates overwrites EVERY payload column on conflict,
 * so including `status` in the payload would regress an order already at 'ordered' or
 * 'received' back to 'required'/'by_tenant', destroying material-order progress.
 * Instead: read the existing order status → call planTenantOrderReconcile() → act on plan:
 *   insert        → POST a new node_order row (on_conflict do-nothing as a race guard)
 *   update_status → PATCH the existing row's status only
 *   skip          → leave the order fully intact (ordered/received are preserved)
 */
export async function setScopeItemPartyAction(
  projectId: string,
  nodeId: string,
  scopeItemTypeId: string,
  party: 'landlord' | 'tenant',
): Promise<SetScopeItemPartyResult> {
  const parsed = setScopeItemPartySchema.safeParse({ projectId, nodeId, scopeItemTypeId, party })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Upsert: insert or update party on conflict (node_id, scope_item_type_id)
  const result = await structurePost(
    supabaseUrl,
    serviceKey,
    'tenant_scope_items',
    { node_id: nodeId, scope_item_type_id: scopeItemTypeId, party },
    'on_conflict=node_id%2Cscope_item_type_id',
  )

  if (!result.ok) {
    // If upsert isn't working (older PostgREST), fall back to PATCH
    const patch = await structurePatch(
      supabaseUrl,
      serviceKey,
      'tenant_scope_items',
      `node_id=eq.${nodeId}&scope_item_type_id=eq.${scopeItemTypeId}`,
      { party },
    )
    if (!patch.ok) return { error: patch.error ?? 'Failed to update scope item' }
  }

  // ── Reconcile the corresponding node_order (§3, §5) ──
  // Read both the scope item type label AND the existing order status in parallel.
  // Reads via .schema() are safe — the cross-schema service-role gotcha applies to writes only.
  const [{ data: scopeType, error: scopeTypeErr }, { data: existingOrder, error: existingOrderErr }] = await Promise.all([
    (guard.supabase as any)
      .schema('structure')
      .from('scope_item_types')
      .select('label')
      .eq('id', scopeItemTypeId)
      .maybeSingle(),
    (guard.supabase as any)
      .schema('structure')
      .from('node_orders')
      .select('status')
      .eq('node_id', nodeId)
      .eq('scope_item_type_id', scopeItemTypeId)
      .maybeSingle(),
  ])

  // Fix 2: a failed node_orders read must not collapse to null (which would
  // trigger a spurious INSERT and silently mask the failure).
  if (existingOrderErr) {
    return { error: 'Scope item saved, but order derivation failed: could not read the existing order.' }
  }

  // Fix 1: a valid scopeItemTypeId must always resolve a scope_item_types row —
  // treat a missing/errored row as a genuine fault rather than silently skipping.
  if (scopeTypeErr || !scopeType) {
    return { error: 'Scope item saved, but order derivation failed: scope item type could not be loaded.' }
  }

  if (scopeType.label) {
    const existingStatus = (existingOrder as { status: NodeOrderStatus } | null)?.status ?? null
    const plan = planTenantOrderReconcile(existingStatus, party)

    if (plan.action === 'insert') {
      // No existing order — INSERT a new row.
      // on_conflict=ignore-duplicates is a race guard only (the read above may
      // lose a concurrent insert); the primary path is always INSERT.
      const orderPayload = deriveTenantNodeOrder(nodeId, projectId, guard.orgId, {
        scopeItemTypeId,
        label: scopeType.label as string,
        party,
      })
      const orderRes = await fetch(
        `${supabaseUrl}/rest/v1/node_orders?on_conflict=node_id%2Cscope_item_type_id`,
        {
          method: 'POST',
          headers: {
            apikey: serviceKey,
            Authorization: `Bearer ${serviceKey}`,
            'Content-Type': 'application/json',
            'Content-Profile': 'structure',
            Prefer: 'resolution=ignore-duplicates,return=minimal',
          },
          body: JSON.stringify(orderPayload),
        },
      )
      if (!orderRes.ok) {
        const text = await orderRes.text()
        // Derivation failure is reported but does NOT roll back the primary scope write.
        return { error: `Scope item saved but node order derivation failed (HTTP ${orderRes.status}): ${text.slice(0, 400)}` }
      }
    } else if (plan.action === 'update_status') {
      // Existing order is at required/by_tenant — safe to flip status. PATCH only
      // `status` and `label`; ordered_at, received_at, notes are left untouched.
      const patchRes = await structurePatch(
        supabaseUrl,
        serviceKey,
        'node_orders',
        `node_id=eq.${nodeId}&scope_item_type_id=eq.${scopeItemTypeId}`,
        { status: plan.status, label: scopeType.label as string },
      )
      if (!patchRes.ok) {
        return { error: `Scope item saved but node order status update failed: ${patchRes.error}` }
      }
    }
    // plan.action === 'skip': order is at ordered/received — leave it fully intact.
  }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// setScopeNotRequiredAction
// ---------------------------------------------------------------------------

const setScopeNotRequiredSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  notRequired: z.boolean(),
})

export type SetScopeNotRequiredResult = { ok: true } | { error: string }

/**
 * Mark (or clear) the "landlord covers the full scope of work" override for a
 * tenant. When set, the tenant schedule report treats scope as complete (N/A)
 * even though no scope document was issued.
 *
 * This writes structure.tenant_details.scope_not_required (migration 00150),
 * which is ORTHOGONAL to the 00118 document-derived scope_status — the trigger
 * never touches this column, so there is no awaited/received conflict. Uses an
 * upsert on the unique node_id: a national tenant may have no tenant_details row
 * yet (the row is otherwise created lazily by the 00118 trigger on document
 * events). PostgREST defaults to merge-duplicates when on_conflict is present,
 * and the payload carries only scope_not_required, so scope_status is preserved.
 */
export async function setScopeNotRequiredAction(
  projectId: string,
  nodeId: string,
  notRequired: boolean,
): Promise<SetScopeNotRequiredResult> {
  const parsed = setScopeNotRequiredSchema.safeParse({ projectId, nodeId, notRequired })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const result = await structurePost(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    { node_id: nodeId, scope_not_required: notRequired },
    'on_conflict=node_id',
  )
  if (!result.ok) return { error: result.error ?? 'Failed to update scope override' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// addScopeItemTypeAction
// ---------------------------------------------------------------------------

const addScopeItemTypeSchema = z.object({
  projectId: uuidSchema,
  orgId: uuidSchema,
  key: z
    .string()
    .min(1)
    .max(64)
    .regex(/^[a-z0-9_-]+$/, 'Key must be lowercase letters, numbers, hyphens, or underscores'),
  label: z.string().min(1).max(100),
})

export type AddScopeItemTypeResult = { ok: true; id: string } | { error: string }

/**
 * Insert a new scope_item_type for the org.
 * Idempotent: if (org, key) already exists returns the existing row's id.
 */
export async function addScopeItemTypeAction(
  projectId: string,
  orgId: string,
  key: string,
  label: string,
): Promise<AddScopeItemTypeResult> {
  const parsed = addScopeItemTypeSchema.safeParse({ projectId, orgId, key: key.trim().toLowerCase(), label: label.trim() })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }
  const { key: safeKey, label: safeLabel } = parsed.data

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // Verify the orgId matches the project's org (belt-and-suspenders)
  if (guard.orgId !== orgId)
    return { error: 'Organisation mismatch' }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Check existing sort_order max so new item goes to end
  const { supabase } = guard
  const { data: existing } = await supabase
    .schema('structure')
    .from('scope_item_types')
    .select('id, sort_order')
    .eq('organisation_id', orgId)
    .order('sort_order', { ascending: false })
    .limit(1)
    .maybeSingle()

  const nextSortOrder = existing ? (existing.sort_order as number) + 1 : 10

  const result = await structurePost(
    supabaseUrl,
    serviceKey,
    'scope_item_types',
    {
      organisation_id: orgId,
      key: safeKey,
      label: safeLabel,
      sort_order: nextSortOrder,
    },
    'on_conflict=organisation_id%2Ckey&Prefer=resolution%3Dmerge-duplicates',
  )

  if (!result.ok) return { error: result.error ?? 'Failed to add scope item type' }

  const rows = result.data as Array<{ id: string }>
  const id = rows?.[0]?.id
  if (!id) return { error: 'INSERT returned no row' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true, id }
}


