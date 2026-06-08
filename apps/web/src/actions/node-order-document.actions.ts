'use server'

/**
 * node-order-document.actions.ts — server actions for node-order documents
 * (quote / order instruction) in the Material Order Tracker.
 *
 *   - attachNodeOrderDocumentAction       — record an uploaded doc in a slot
 *   - clearNodeOrderDocumentAction        — remove a doc from a slot
 *   - getNodeOrderDocumentSignedUrlAction — short-lived signed URL for view/download
 *
 * Cross-schema write pattern (CLAUDE.md 2026-05-18 gotcha): writes to
 * structure.* go through raw PostgREST fetch with Content-Profile: structure +
 * the service-role key. Reads use the cookie-authenticated client.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'

const BUCKET = 'node-order-documents'
const uuidSchema = z.string().uuid()
const docTypeSchema = z.enum(['quote', 'order_instruction'])

// ---------------------------------------------------------------------------
// structure.* raw-fetch helpers
// ---------------------------------------------------------------------------

function structureHeaders(serviceKey: string, prefer = 'return=minimal'): HeadersInit {
  return {
    apikey: serviceKey,
    Authorization: `Bearer ${serviceKey}`,
    'Content-Type': 'application/json',
    'Content-Profile': 'structure',
    Prefer: prefer,
  }
}

async function structureInsert(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
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
    return { ok: false, error: `DELETE structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Auth + ownership guards
// ---------------------------------------------------------------------------

async function guardProjectAccess(projectId: string): Promise<
  | { error: string; user?: undefined; supabase?: undefined }
  | { error?: undefined; user: { id: string }; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }

  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }

  return { user: { id: user.id }, supabase }
}

/** Confirm a node order belongs to the project (RLS-gated cookie read). */
async function guardOrderBelongsToProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  nodeOrderId: string,
  projectId: string,
): Promise<{ error: string } | null> {
  const { data: order } = await (supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_orders')
    .select('id')
    .eq('id', nodeOrderId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!order) return { error: 'Node order not found' }
  return null
}

// ---------------------------------------------------------------------------
// attachNodeOrderDocumentAction
// ---------------------------------------------------------------------------

const attachSchema = z.object({
  projectId: uuidSchema,
  nodeOrderId: uuidSchema,
  docType: docTypeSchema,
  storagePath: z.string().min(1),
  fileName: z.string().min(1).max(255),
})

export type AttachNodeOrderDocumentResult = { ok: true } | { error: string }

/**
 * Record an uploaded document against a node order's slot. Each (order, type)
 * is a single slot — an existing document of the same type is replaced (its row
 * removed and its storage object cleaned up).
 */
export async function attachNodeOrderDocumentAction(
  projectId: string,
  nodeOrderId: string,
  docType: string,
  storagePath: string,
  fileName: string,
): Promise<AttachNodeOrderDocumentResult> {
  const parsed = attachSchema.safeParse({ projectId, nodeOrderId, docType, storagePath, fileName })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderErr = await guardOrderBelongsToProject(guard.supabase, nodeOrderId, projectId)
  if (orderErr) return orderErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // Capture any existing document in this slot so its storage object can be
  // cleaned up after the replacement is committed.
  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_order_documents')
    .select('storage_path')
    .eq('node_order_id', nodeOrderId)
    .eq('doc_type', docType)
    .maybeSingle()
  const oldPath = (existing as { storage_path: string } | null)?.storage_path ?? null

  // Replace the slot: delete the old row, then insert the new one.
  const del = await structureDelete(
    supabaseUrl,
    serviceKey,
    'node_order_documents',
    `node_order_id=eq.${nodeOrderId}&doc_type=eq.${docType}`,
  )
  if (!del.ok) return { error: del.error ?? 'Failed to replace existing document' }

  const ins = await structureInsert(supabaseUrl, serviceKey, 'node_order_documents', {
    node_order_id: nodeOrderId,
    doc_type: parsed.data.docType,
    storage_path: parsed.data.storagePath,
    file_name: parsed.data.fileName,
    uploaded_by: guard.user.id,
  })
  if (!ins.ok) return { error: ins.error ?? 'Failed to record document' }

  // Best-effort: remove the superseded storage object.
  if (oldPath && oldPath !== parsed.data.storagePath) {
    await guard.supabase.storage.from(BUCKET).remove([oldPath])
  }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// clearNodeOrderDocumentAction
// ---------------------------------------------------------------------------

export type ClearNodeOrderDocumentResult = { ok: true } | { error: string }

/** Remove a document from a node order's slot (DB row + storage object). */
export async function clearNodeOrderDocumentAction(
  projectId: string,
  nodeOrderId: string,
  docType: string,
): Promise<ClearNodeOrderDocumentResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeOrderId: uuidSchema, docType: docTypeSchema })
    .safeParse({ projectId, nodeOrderId, docType })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderErr = await guardOrderBelongsToProject(guard.supabase, nodeOrderId, projectId)
  if (orderErr) return orderErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const { data: existing } = await (guard.supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_order_documents')
    .select('storage_path')
    .eq('node_order_id', nodeOrderId)
    .eq('doc_type', docType)
    .maybeSingle()
  const path = (existing as { storage_path: string } | null)?.storage_path ?? null

  // Clear the DB row first (source of truth), then remove the storage object.
  const del = await structureDelete(
    supabaseUrl,
    serviceKey,
    'node_order_documents',
    `node_order_id=eq.${nodeOrderId}&doc_type=eq.${docType}`,
  )
  if (!del.ok) return { error: del.error ?? 'Failed to remove document' }

  if (path) {
    await guard.supabase.storage.from(BUCKET).remove([path])
  }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getNodeOrderDocumentSignedUrlAction
// ---------------------------------------------------------------------------

export type GetNodeOrderDocumentSignedUrlResult = { url: string } | { error: string }

/** Short-lived (300 s) signed URL for previewing / downloading a document. */
export async function getNodeOrderDocumentSignedUrlAction(
  projectId: string,
  storagePath: string,
  downloadName?: string,
): Promise<GetNodeOrderDocumentSignedUrlResult> {
  const parsed = z
    .object({ projectId: uuidSchema, storagePath: z.string().min(1) })
    .safeParse({ projectId, storagePath })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // downloadName set → Content-Disposition: attachment (forces a download with
  // that filename). Omitted → inline URL for in-tab preview.
  const { data, error } = await guard.supabase.storage
    .from(BUCKET)
    .createSignedUrl(storagePath, 300, downloadName ? { download: downloadName } : undefined)

  if (error || !data?.signedUrl) {
    return { error: error?.message ?? 'Could not generate signed URL' }
  }
  return { url: data.signedUrl }
}
