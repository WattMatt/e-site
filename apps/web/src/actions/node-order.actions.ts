'use server'

/**
 * node-order.actions.ts — server actions for the node_orders status lifecycle.
 *
 * Covers:
 *   - markOrderedAction   — required → ordered  (sets ordered_at; optional caller date)
 *   - markReceivedAction  — ordered  → received (sets received_at; optional caller date)
 *   - updateOrderNotesAction — edit free-text notes on any order, any status
 *
 * Transition diagram (design-doc §5):
 *   by_tenant   ← re-derived from scope changes (Task 4.2), not user-driven here
 *   required → ordered → received
 *
 * M2: no PO / supplier-reference field — notes only.
 * M4: no notification dispatch in v1.
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha):
 *   supabase-js `.schema('structure').from(...).update()` silently strips the
 *   service-role auth header → RLS denies. All writes to structure.node_orders use
 *   raw fetch to PostgREST with Content-Profile: structure + service-role key.
 *   Reads go through the cookie-authenticated supabase-js client as normal.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

// ---------------------------------------------------------------------------
// PostgREST helpers — same shape as tenant-scope.actions.ts / equipment.actions.ts
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: 'return=minimal',
  }
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

// ---------------------------------------------------------------------------
// Auth + project-access guard — mirrors tenant-scope.actions.ts exactly
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
 * Validate that orderId belongs to projectId using the RLS-gated cookie client.
 * Returns the current status so callers can enforce valid transitions without
 * a second round-trip.
 *
 * The cookie client is org-scoped via RLS, so an order outside the user's org
 * returns null even if the UUID is valid. Reads through .schema() are safe —
 * the cross-schema service-role gotcha applies to writes only.
 */
async function guardOrderBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orderId: string,
  projectId: string,
): Promise<
  | { error: string; currentStatus?: undefined }
  | { error?: undefined; currentStatus: string }
> {
  const { data: order, error } = await (supabase as any)
    .schema('structure')
    .from('node_orders')
    .select('id, status')
    .eq('id', orderId)
    .eq('project_id', projectId)
    .maybeSingle()

  if (error) return { error: 'Could not verify order ownership' }
  if (!order) return { error: 'Order not found or access denied' }

  return { currentStatus: (order as { id: string; status: string }).status }
}

// ---------------------------------------------------------------------------
// Shared: today's ISO date string
// ---------------------------------------------------------------------------

function todayIso(): string {
  return new Date().toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// Shared: revalidate all paths that show node order status
// ---------------------------------------------------------------------------

function revalidateOrderPaths(projectId: string): void {
  revalidatePath(`/projects/${projectId}/tenant-schedule`)
  revalidatePath(`/projects/${projectId}/equipment-schedule`)
  revalidatePath(`/projects/${projectId}/materials`)
}

// ---------------------------------------------------------------------------
// markOrderedAction — required → ordered
// ---------------------------------------------------------------------------

const markOrderedSchema = z.object({
  projectId: uuidSchema,
  orderId: uuidSchema,
  orderedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // ISO date; defaults to today
  notes: z.string().max(2000).optional(),
})

export type MarkOrderedResult = { ok: true } | { error: string }

/**
 * Advance a node order from `required` → `ordered`.
 * Sets `ordered_at` to the supplied date or today if omitted.
 * Optionally updates the free-text `notes` field in the same PATCH.
 *
 * Only `required` orders may be marked ordered — attempting to re-mark an
 * already-ordered or received order returns a descriptive error so the UI
 * can show a helpful message rather than silently no-op'ing.
 */
export async function markOrderedAction(
  projectId: string,
  orderId: string,
  opts: { orderedAt?: string; notes?: string } = {},
): Promise<MarkOrderedResult> {
  const parsed = markOrderedSchema.safeParse({ projectId, orderId, ...opts })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderGuard = await guardOrderBelongsToProject(guard.supabase, orderId, projectId)
  if (orderGuard.error !== undefined) return { error: orderGuard.error }

  if (orderGuard.currentStatus !== 'required') {
    return { error: `Order is already '${orderGuard.currentStatus}' — can only mark ordered from 'required'` }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const patch: Record<string, unknown> = {
    status: 'ordered',
    ordered_at: parsed.data.orderedAt ?? todayIso(),
  }
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes

  const result = await structurePatch(supabaseUrl, serviceKey, 'node_orders', `id=eq.${orderId}`, patch)
  if (!result.ok) return { error: result.error ?? 'Failed to mark order as ordered' }

  revalidateOrderPaths(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// markReceivedAction — ordered → received
// ---------------------------------------------------------------------------

const markReceivedSchema = z.object({
  projectId: uuidSchema,
  orderId: uuidSchema,
  receivedAt: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(), // ISO date; defaults to today
  notes: z.string().max(2000).optional(),
})

export type MarkReceivedResult = { ok: true } | { error: string }

/**
 * Advance a node order from `ordered` → `received`.
 * Sets `received_at` to the supplied date or today if omitted.
 * Optionally updates the free-text `notes` field in the same PATCH.
 *
 * Only `ordered` orders may be marked received — attempting to mark a
 * `required` or already-`received` order returns a descriptive error.
 */
export async function markReceivedAction(
  projectId: string,
  orderId: string,
  opts: { receivedAt?: string; notes?: string } = {},
): Promise<MarkReceivedResult> {
  const parsed = markReceivedSchema.safeParse({ projectId, orderId, ...opts })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderGuard = await guardOrderBelongsToProject(guard.supabase, orderId, projectId)
  if (orderGuard.error !== undefined) return { error: orderGuard.error }

  if (orderGuard.currentStatus !== 'ordered') {
    return { error: `Order is '${orderGuard.currentStatus}' — can only mark received from 'ordered'` }
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const patch: Record<string, unknown> = {
    status: 'received',
    received_at: parsed.data.receivedAt ?? todayIso(),
  }
  if (parsed.data.notes !== undefined) patch.notes = parsed.data.notes

  const result = await structurePatch(supabaseUrl, serviceKey, 'node_orders', `id=eq.${orderId}`, patch)
  if (!result.ok) return { error: result.error ?? 'Failed to mark order as received' }

  revalidateOrderPaths(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// updateOrderNotesAction — edit notes on any order, any status
// ---------------------------------------------------------------------------

const updateOrderNotesSchema = z.object({
  projectId: uuidSchema,
  orderId: uuidSchema,
  notes: z.string().max(2000),
})

export type UpdateOrderNotesResult = { ok: true } | { error: string }

/**
 * Update the free-text notes on a node order regardless of its current status.
 * Does NOT change status, ordered_at, or received_at.
 * Callable on `required`, `ordered`, `received`, and `by_tenant` orders.
 */
export async function updateOrderNotesAction(
  projectId: string,
  orderId: string,
  notes: string,
): Promise<UpdateOrderNotesResult> {
  const parsed = updateOrderNotesSchema.safeParse({ projectId, orderId, notes })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderGuard = await guardOrderBelongsToProject(guard.supabase, orderId, projectId)
  if (orderGuard.error !== undefined) return { error: orderGuard.error }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const result = await structurePatch(supabaseUrl, serviceKey, 'node_orders', `id=eq.${orderId}`, {
    notes: parsed.data.notes,
  })
  if (!result.ok) return { error: result.error ?? 'Failed to update notes' }

  revalidateOrderPaths(projectId)
  return { ok: true }
}
