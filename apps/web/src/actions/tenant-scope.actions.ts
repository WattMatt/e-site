'use server'

/**
 * tenant-scope.actions.ts — server actions for scope-of-work tracking.
 *
 * Covers:
 *   - setScopeItemPartyAction   — set Landlord/Tenant for a (node, scope_item_type) pair
 *   - addScopeItemTypeAction    — add a new org-level scope item type to the registry
 *   - setScopeStatusAction      — set scope_status (awaited | received) on tenant_details
 *   - attachScopeDocumentAction — record scope_document_path after client-side upload
 *   - clearScopeDocumentAction  — remove scope_document_path from tenant_details
 *   - getScopeSignedUrlAction   — get a short-lived signed URL for preview/download
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
import { projectService, deriveTenantNodeOrder, planTenantOrderReconcile } from '@esite/shared'
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
  const { data: node } = await (supabase as any)
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
 * 'received' back to 'required'/'by_tenant', destroying procurement progress.
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
  const [{ data: scopeType }, { data: existingOrder }] = await Promise.all([
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

  if (scopeType?.label) {
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
  const { data: existing } = await (supabase as any)
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

// ---------------------------------------------------------------------------
// setScopeStatusAction
// ---------------------------------------------------------------------------

const setScopeStatusSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  status: z.enum(['awaited', 'received']),
})

export type SetScopeStatusResult = { ok: true } | { error: string }

/**
 * Update tenant_details.scope_status for a tenant node.
 * Also ensures the tenant_details row exists (upsert-ignore if missing).
 */
export async function setScopeStatusAction(
  projectId: string,
  nodeId: string,
  status: 'awaited' | 'received',
): Promise<SetScopeStatusResult> {
  const parsed = setScopeStatusSchema.safeParse({ projectId, nodeId, status })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Ensure the row exists first (upsert-ignore)
  const ensureRes = await fetch(`${supabaseUrl}/rest/v1/tenant_details?on_conflict=node_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'structure',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ node_id: nodeId }),
  })
  if (!ensureRes.ok) {
    const text = await ensureRes.text()
    return { error: `Failed to ensure tenant_details row (HTTP ${ensureRes.status}): ${text.slice(0, 200)}` }
  }

  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    { scope_status: status },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to update scope status' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// attachScopeDocumentAction
// ---------------------------------------------------------------------------

const attachScopeDocumentSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  storagePath: z.string().min(1),
})

export type AttachScopeDocumentResult = { ok: true } | { error: string }

/**
 * Record a scope_document_path on tenant_details after the client has
 * uploaded the file to the tenant-documents bucket.
 */
export async function attachScopeDocumentAction(
  projectId: string,
  nodeId: string,
  storagePath: string,
): Promise<AttachScopeDocumentResult> {
  const parsed = attachScopeDocumentSchema.safeParse({ projectId, nodeId, storagePath })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Ensure row exists
  const ensureRes = await fetch(`${supabaseUrl}/rest/v1/tenant_details?on_conflict=node_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'structure',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ node_id: nodeId }),
  })
  if (!ensureRes.ok) {
    const text = await ensureRes.text()
    return { error: `Failed to ensure tenant_details row (HTTP ${ensureRes.status}): ${text.slice(0, 200)}` }
  }

  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    { scope_document_path: storagePath, scope_status: 'received' },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to attach scope document' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// clearScopeDocumentAction
// ---------------------------------------------------------------------------

export type ClearScopeDocumentResult = { ok: true } | { error: string }

/**
 * Remove the scope_document_path from tenant_details.
 * Also removes the file from the tenant-documents bucket.
 */
export async function clearScopeDocumentAction(
  projectId: string,
  nodeId: string,
  storagePath: string,
): Promise<ClearScopeDocumentResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, storagePath: z.string().min(1) })
    .safeParse({ projectId, nodeId, storagePath })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const { supabase } = guard

  const nodeErr = await guardNodeBelongsToProject(supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Clear the DB path FIRST (source of truth). Only then remove from storage
  // so a storage failure never leaves the row pointing at a deleted file.
  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    { scope_document_path: null },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to clear scope document' }

  // Remove from storage (best-effort — row is already cleared)
  await supabase.storage.from('tenant-documents').remove([storagePath])

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getScopeSignedUrlAction
// ---------------------------------------------------------------------------

export type GetScopeSignedUrlResult = { url: string } | { error: string }

/**
 * Create a short-lived (300 s) signed URL for a scope document.
 * Used for inline preview and the download link.
 */
export async function getScopeSignedUrlAction(
  projectId: string,
  storagePath: string,
): Promise<GetScopeSignedUrlResult> {
  const parsed = z
    .object({ projectId: uuidSchema, storagePath: z.string().min(1) })
    .safeParse({ projectId, storagePath })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const { supabase } = guard

  const { data, error } = await supabase.storage
    .from('tenant-documents')
    .createSignedUrl(storagePath, 300)

  if (error || !data?.signedUrl) return { error: error?.message ?? 'Could not generate signed URL' }

  return { url: data.signedUrl }
}

// ---------------------------------------------------------------------------
// setLayoutStatusAction
// ---------------------------------------------------------------------------

const setLayoutStatusSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  status: z.enum(['not_issued', 'issued']),
  issuedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
})

export type SetLayoutStatusResult = { ok: true } | { error: string }

/**
 * Update tenant_details.layout_status + layout_issued_at for a tenant node.
 * Also ensures the tenant_details row exists (upsert-ignore if missing).
 * issuedAt is a YYYY-MM-DD string; pass null to clear it.
 */
export async function setLayoutStatusAction(
  projectId: string,
  nodeId: string,
  status: 'not_issued' | 'issued',
  issuedAt: string | null,
): Promise<SetLayoutStatusResult> {
  const parsed = setLayoutStatusSchema.safeParse({ projectId, nodeId, status, issuedAt })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Ensure the row exists first (upsert-ignore)
  const ensureRes = await fetch(`${supabaseUrl}/rest/v1/tenant_details?on_conflict=node_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'structure',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ node_id: nodeId }),
  })
  if (!ensureRes.ok) {
    const text = await ensureRes.text()
    return { error: `Failed to ensure tenant_details row (HTTP ${ensureRes.status}): ${text.slice(0, 200)}` }
  }

  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    { layout_status: status, layout_issued_at: issuedAt },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to update layout status' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// attachLayoutDrawingAction
// ---------------------------------------------------------------------------

const attachLayoutDrawingSchema = z.object({
  projectId: uuidSchema,
  nodeId: uuidSchema,
  storagePath: z.string().min(1),
})

export type AttachLayoutDrawingResult = { ok: true } | { error: string }

/**
 * Record a layout_drawing_path on tenant_details after the client has
 * uploaded the file to the tenant-documents bucket.
 * Also sets layout_status = 'issued' and layout_issued_at = today if not already set.
 */
export async function attachLayoutDrawingAction(
  projectId: string,
  nodeId: string,
  storagePath: string,
): Promise<AttachLayoutDrawingResult> {
  const parsed = attachLayoutDrawingSchema.safeParse({ projectId, nodeId, storagePath })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const nodeErr = await guardNodeBelongsToProject(guard.supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Ensure the row exists
  const ensureRes = await fetch(`${supabaseUrl}/rest/v1/tenant_details?on_conflict=node_id`, {
    method: 'POST',
    headers: {
      apikey: serviceKey,
      Authorization: `Bearer ${serviceKey}`,
      'Content-Type': 'application/json',
      'Content-Profile': 'structure',
      Prefer: 'resolution=ignore-duplicates',
    },
    body: JSON.stringify({ node_id: nodeId }),
  })
  if (!ensureRes.ok) {
    const text = await ensureRes.text()
    return { error: `Failed to ensure tenant_details row (HTTP ${ensureRes.status}): ${text.slice(0, 200)}` }
  }

  // Read the current layout_issued_at so we don't clobber an existing date
  const { data: existing } = await (guard.supabase as any)
    .schema('structure')
    .from('tenant_details')
    .select('layout_issued_at')
    .eq('node_id', nodeId)
    .maybeSingle()

  const today = new Date().toISOString().slice(0, 10)
  const issuedAt = (existing as { layout_issued_at: string | null } | null)?.layout_issued_at ?? today

  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    {
      layout_drawing_path: storagePath,
      layout_status: 'issued',
      layout_issued_at: issuedAt,
    },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to attach layout drawing' }

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// clearLayoutDrawingAction
// ---------------------------------------------------------------------------

export type ClearLayoutDrawingResult = { ok: true } | { error: string }

/**
 * Remove the layout_drawing_path from tenant_details.
 * Also removes the file from the tenant-documents bucket (best-effort).
 * Does NOT clear layout_status or layout_issued_at — those stay set.
 */
export async function clearLayoutDrawingAction(
  projectId: string,
  nodeId: string,
  storagePath: string,
): Promise<ClearLayoutDrawingResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeId: uuidSchema, storagePath: z.string().min(1) })
    .safeParse({ projectId, nodeId, storagePath })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const { supabase } = guard

  const nodeErr = await guardNodeBelongsToProject(supabase, nodeId, projectId)
  if (nodeErr) return nodeErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Clear the DB path FIRST (source of truth). Only then remove from storage
  // so a storage failure never leaves the row pointing at a deleted file.
  const result = await structurePatch(
    supabaseUrl,
    serviceKey,
    'tenant_details',
    `node_id=eq.${nodeId}`,
    { layout_drawing_path: null },
  )

  if (!result.ok) return { error: result.error ?? 'Failed to clear layout drawing' }

  // Remove from storage (best-effort — row is already cleared)
  await supabase.storage.from('tenant-documents').remove([storagePath])

  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getLayoutSignedUrlAction
// ---------------------------------------------------------------------------

export type GetLayoutSignedUrlResult = { url: string } | { error: string }

/**
 * Create a short-lived (300 s) signed URL for a layout drawing.
 * Used for inline preview and the download link.
 */
export async function getLayoutSignedUrlAction(
  projectId: string,
  storagePath: string,
): Promise<GetLayoutSignedUrlResult> {
  const parsed = z
    .object({ projectId: uuidSchema, storagePath: z.string().min(1) })
    .safeParse({ projectId, storagePath })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const { supabase } = guard

  const { data, error } = await supabase.storage
    .from('tenant-documents')
    .createSignedUrl(storagePath, 300)

  if (error || !data?.signedUrl) return { error: error?.message ?? 'Could not generate signed URL' }

  return { url: data.signedUrl }
}
