'use server'

/**
 * node-order-document.actions.ts — server actions for node-order documents
 * (quote / order instruction) in the Material Order Tracker.
 *
 *   - addNodeOrderDocumentAction          — append a document to a slot
 *   - updateNodeOrderDocumentMetaAction   — edit a document's label + kind
 *   - deleteNodeOrderDocumentAction       — remove a document (row + storage)
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

async function structurePatch(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
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
// addNodeOrderDocumentAction — append a document to a slot (no replace)
// ---------------------------------------------------------------------------

const docKindSchema = z.enum(['original', 'revision', 'variation'])

const addSchema = z.object({
  projectId: uuidSchema,
  nodeOrderId: uuidSchema,
  docType: docTypeSchema,
  storagePath: z.string().min(1),
  fileName: z.string().min(1).max(255),
  label: z.string().max(120).nullable().optional(),
  kind: docKindSchema.optional(),
})

export type AddNodeOrderDocumentResult = { ok: true } | { error: string }

/**
 * Record an uploaded document against a node order's slot. Multiple documents
 * per (order, type) are allowed — this always inserts (append), never replaces.
 */
export async function addNodeOrderDocumentAction(
  projectId: string,
  nodeOrderId: string,
  docType: string,
  storagePath: string,
  fileName: string,
  label?: string | null,
  kind?: 'original' | 'revision' | 'variation',
): Promise<AddNodeOrderDocumentResult> {
  const parsed = addSchema.safeParse({ projectId, nodeOrderId, docType, storagePath, fileName, label, kind })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const orderErr = await guardOrderBelongsToProject(guard.supabase, nodeOrderId, projectId)
  if (orderErr) return orderErr

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const ins = await structureInsert(supabaseUrl, serviceKey, 'node_order_documents', {
    node_order_id: nodeOrderId,
    doc_type: parsed.data.docType,
    storage_path: parsed.data.storagePath,
    file_name: parsed.data.fileName,
    label: parsed.data.label ?? null,
    kind: parsed.data.kind ?? 'original',
    uploaded_by: guard.user.id,
  })
  if (!ins.ok) return { error: ins.error ?? 'Failed to record document' }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// Shared: confirm a document belongs to the project, returning its row
// ---------------------------------------------------------------------------

/** Read a doc row (RLS-gated) and confirm its order is in the project. */
async function guardDocumentInProject(
  supabase: Awaited<ReturnType<typeof createClient>>,
  documentId: string,
  projectId: string,
): Promise<{ error: string } | { row: { node_order_id: string; storage_path: string } }> {
  const { data: doc } = await (supabase as never as {
    schema: (s: string) => { from: (t: string) => any }
  })
    .schema('structure')
    .from('node_order_documents')
    .select('node_order_id, storage_path')
    .eq('id', documentId)
    .maybeSingle()
  const row = doc as { node_order_id: string; storage_path: string } | null
  if (!row) return { error: 'Document not found' }

  const orderErr = await guardOrderBelongsToProject(supabase, row.node_order_id, projectId)
  if (orderErr) return orderErr
  return { row }
}

// ---------------------------------------------------------------------------
// updateNodeOrderDocumentMetaAction — edit a document's label + kind
// ---------------------------------------------------------------------------

const updateMetaSchema = z.object({
  projectId: uuidSchema,
  documentId: uuidSchema,
  label: z.string().max(120).nullable(),
  kind: docKindSchema,
})

export type UpdateNodeOrderDocumentMetaResult = { ok: true } | { error: string }

export async function updateNodeOrderDocumentMetaAction(
  projectId: string,
  documentId: string,
  meta: { label: string | null; kind: 'original' | 'revision' | 'variation' },
): Promise<UpdateNodeOrderDocumentMetaResult> {
  const parsed = updateMetaSchema.safeParse({ projectId, documentId, label: meta.label, kind: meta.kind })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const owned = await guardDocumentInProject(guard.supabase, documentId, projectId)
  if ('error' in owned) return owned

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  const patch = await structurePatch(supabaseUrl, serviceKey, 'node_order_documents', `id=eq.${documentId}`, {
    // Coerce a blank label to NULL so the stored representation matches `add`.
    label: parsed.data.label && parsed.data.label.length > 0 ? parsed.data.label : null,
    kind: parsed.data.kind,
  })
  if (!patch.ok) return { error: patch.error ?? 'Failed to update document' }

  revalidatePath(`/projects/${projectId}/materials`)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// deleteNodeOrderDocumentAction — remove one document (row + storage object)
// ---------------------------------------------------------------------------

export type DeleteNodeOrderDocumentResult = { ok: true } | { error: string }

/** Delete a single document by id (DB row + its storage object). */
export async function deleteNodeOrderDocumentAction(
  projectId: string,
  documentId: string,
): Promise<DeleteNodeOrderDocumentResult> {
  const parsed = z
    .object({ projectId: uuidSchema, documentId: uuidSchema })
    .safeParse({ projectId, documentId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  const owned = await guardDocumentInProject(guard.supabase, documentId, projectId)
  if ('error' in owned) return owned

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!serviceKey || !supabaseUrl) return { error: 'Server misconfigured' }

  // DB row first (source of truth), then best-effort storage cleanup.
  const del = await structureDelete(supabaseUrl, serviceKey, 'node_order_documents', `id=eq.${documentId}`)
  if (!del.ok) return { error: del.error ?? 'Failed to remove document' }

  if (owned.row.storage_path) {
    await guard.supabase.storage.from(BUCKET).remove([owned.row.storage_path])
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
