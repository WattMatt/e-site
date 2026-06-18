'use server'

/**
 * node-order-shop-drawing.actions.ts — server actions for the multi shop-drawing
 * workflow on a material order.
 *
 *   - addShopDrawingAction          — record an uploaded drawing (status 'awaiting')
 *   - markShopDrawingReceivedAction — awaiting → received
 *   - approveShopDrawingAction      — received → approved + auto-file into handover
 *   - revertShopDrawingAction       — step status back one stage (un-files if leaving 'approved')
 *   - removeShopDrawingAction       — delete drawing (+ linked handover doc if approved)
 *   - getShopDrawingSignedUrlAction — short-lived signed URL for view/download
 *
 * structure.* writes use raw PostgREST + service-role (schema not PostgREST-
 * exposed). The handover document (tenants.documents) is written with the
 * cookie client. Approval copies the file from the node-order-documents bucket
 * to the project-documents bucket at the handover path.
 */

import { z } from 'zod'
import { revalidatePath } from 'next/cache'
import { createClient } from '@/lib/supabase/server'
import { ensureHandoverCategoryRoot } from '@/lib/handover/handover-filing'
import {
  projectService,
  resolveHandoverCategory,
  buildHandoverDrawingName,
  ALL_CATEGORIES,
  type HandoverCategory,
} from '@esite/shared'

const DRAWINGS_BUCKET = 'node-order-documents'
const HANDOVER_BUCKET = 'project-documents'
const uuidSchema = z.string().uuid()
const categorySchema = z.enum(ALL_CATEGORIES as [HandoverCategory, ...HandoverCategory[]])

// ---------------------------------------------------------------------------
// structure.* raw-fetch helpers (local copy — no shared module exists)
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

async function structureInsertReturningId(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  body: Record<string, unknown>,
): Promise<{ ok: boolean; id?: string; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}`, {
    method: 'POST',
    headers: structureHeaders(serviceKey, 'return=representation'),
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `INSERT structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  const rows = (await res.json()) as Array<{ id: string }>
  return { ok: true, id: rows[0]?.id }
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
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true }
}

async function structurePatchReturning(
  supabaseUrl: string,
  serviceKey: string,
  table: string,
  filterQuery: string,
  patch: Record<string, unknown>,
): Promise<{ ok: boolean; rows?: unknown[]; error?: string }> {
  const res = await fetch(`${supabaseUrl}/rest/v1/${table}?${filterQuery}`, {
    method: 'PATCH',
    headers: structureHeaders(serviceKey, 'return=representation'),
    body: JSON.stringify(patch),
  })
  if (!res.ok) {
    const text = await res.text()
    return { ok: false, error: `PATCH structure.${table} failed (HTTP ${res.status}): ${text.slice(0, 300)}` }
  }
  return { ok: true, rows: (await res.json()) as unknown[] }
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
// Guards + env
// ---------------------------------------------------------------------------

type StructureSchemaClient = { schema: (s: string) => { from: (t: string) => any } }

async function guardProjectAccess(
  projectId: string,
  opts: { requireManage?: boolean } = {},
): Promise<
  | { error: string; user?: undefined; orgId?: undefined; supabase?: undefined }
  | { error?: undefined; user: { id: string }; orgId: string; supabase: Awaited<ReturnType<typeof createClient>> }
> {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated' }
  const project = await projectService.getById(supabase as never, projectId)
  if (!project) return { error: 'Project not found' }
  if (opts.requireManage) {
    const { data: canManage, error } = await (supabase as any).rpc('user_can_manage_project', { p_project_id: projectId })
    if (error) return { error: `Authorization check failed: ${error.message}` }
    if (!canManage) return { error: 'You do not have permission to manage this project' }
  }
  return { user: { id: user.id }, orgId: (project as { organisation_id: string }).organisation_id, supabase }
}

function serviceEnv(): { url: string; key: string } | { error: string } {
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  if (!key || !url) return { error: 'Server misconfigured' }
  return { url, key }
}

interface DrawingContext {
  drawing: { id: string; node_order_id: string; status: string; storage_path: string; file_name: string; handover_document_id: string | null }
  order: { id: string; node_id: string; scope_item_type_id: string | null; label: string }
  node: { kind: string | null; handover_category: string | null } | null
  scopeKey: string | null
  scopeTypeOverride: string | null
}

/** Load a drawing + its order/node/scope context, asserting project ownership. */
async function loadDrawingContext(
  supabase: Awaited<ReturnType<typeof createClient>>,
  drawingId: string,
  projectId: string,
): Promise<{ ctx: DrawingContext } | { error: string }> {
  const sc = supabase as never as StructureSchemaClient
  const { data: drawing } = await sc
    .schema('structure')
    .from('node_order_shop_drawings')
    .select('id, node_order_id, status, storage_path, file_name, handover_document_id')
    .eq('id', drawingId)
    .maybeSingle()
  if (!drawing) return { error: 'Drawing not found' }

  const { data: order } = await sc
    .schema('structure')
    .from('node_orders')
    .select('id, node_id, scope_item_type_id, label, project_id')
    .eq('id', drawing.node_order_id)
    .maybeSingle()
  if (!order || order.project_id !== projectId) return { error: 'Drawing does not belong to this project' }

  const { data: node } = await sc
    .schema('structure')
    .from('nodes')
    .select('kind, handover_category')
    .eq('id', order.node_id)
    .maybeSingle()

  let scopeKey: string | null = null
  let scopeTypeOverride: string | null = null
  if (order.scope_item_type_id) {
    const { data: st } = await sc
      .schema('structure')
      .from('scope_item_types')
      .select('key, handover_category')
      .eq('id', order.scope_item_type_id)
      .maybeSingle()
    scopeKey = (st as { key: string | null } | null)?.key ?? null
    scopeTypeOverride = (st as { handover_category: string | null } | null)?.handover_category ?? null
  }

  return {
    ctx: {
      drawing: drawing as DrawingContext['drawing'],
      order: order as DrawingContext['order'],
      node: (node as DrawingContext['node']) ?? null,
      scopeKey,
      scopeTypeOverride,
    },
  }
}

function revalidate(projectId: string): void {
  revalidatePath(`/projects/${projectId}/materials`)
  revalidatePath(`/projects/${projectId}/handover`)
  revalidatePath(`/projects/${projectId}/handover/documents`)
}

// ---------------------------------------------------------------------------
// addShopDrawingAction
// ---------------------------------------------------------------------------

export type AddShopDrawingResult = { ok: true } | { error: string }

export async function addShopDrawingAction(
  projectId: string,
  nodeOrderId: string,
  storagePath: string,
  fileName: string,
): Promise<AddShopDrawingResult> {
  const parsed = z
    .object({ projectId: uuidSchema, nodeOrderId: uuidSchema, storagePath: z.string().min(1), fileName: z.string().min(1).max(255) })
    .safeParse({ projectId, nodeOrderId, storagePath, fileName })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId, { requireManage: true })
  if (guard.error !== undefined) return { error: guard.error }

  const { data: order } = await (guard.supabase as never as StructureSchemaClient)
    .schema('structure')
    .from('node_orders')
    .select('id')
    .eq('id', nodeOrderId)
    .eq('project_id', projectId)
    .maybeSingle()
  if (!order) return { error: 'Node order not found' }

  const env = serviceEnv()
  if ('error' in env) return env

  const ins = await structureInsertReturningId(env.url, env.key, 'node_order_shop_drawings', {
    node_order_id: nodeOrderId,
    storage_path: parsed.data.storagePath,
    file_name: parsed.data.fileName,
    status: 'awaiting',
    uploaded_by: guard.user.id,
  })
  if (!ins.ok) return { error: ins.error ?? 'Failed to record drawing' }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// markShopDrawingReceivedAction
// ---------------------------------------------------------------------------

export type ShopDrawingStatusResult = { ok: true } | { error: string }

export async function markShopDrawingReceivedAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId, { requireManage: true })
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  if (loaded.ctx.drawing.status !== 'awaiting') {
    return { error: `Can only mark received from 'awaiting' (currently '${loaded.ctx.drawing.status}')` }
  }

  const env = serviceEnv()
  if ('error' in env) return env

  const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
    status: 'received',
    received_at: new Date().toISOString(),
  })
  if (!patch.ok) return { error: patch.error ?? 'Failed to mark received' }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// approveShopDrawingAction (+ auto-file into handover)
// ---------------------------------------------------------------------------

export type ApproveShopDrawingResult = { ok: true } | { needsCategory: true } | { error: string }

export async function approveShopDrawingAction(
  projectId: string,
  drawingId: string,
  categoryOverride?: string,
): Promise<ApproveShopDrawingResult> {
  const parsed = z
    .object({
      projectId: uuidSchema,
      drawingId: uuidSchema,
      categoryOverride: categorySchema.optional(),
    })
    .safeParse({ projectId, drawingId, categoryOverride })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId, { requireManage: true })
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  if (ctx.drawing.status === 'approved' && ctx.drawing.handover_document_id) return { ok: true }
  if (ctx.drawing.status !== 'received') {
    return { error: `Can only approve from 'received' (currently '${ctx.drawing.status}')` }
  }

  const category =
    parsed.data.categoryOverride ??
    resolveHandoverCategory({
      scopeKey: ctx.scopeKey,
      scopeTypeOverride: ctx.scopeTypeOverride,
      kind: ctx.node?.kind,
      nodeOverride: ctx.node?.handover_category,
    })
  if (!category) return { needsCategory: true }

  const env = serviceEnv()
  if ('error' in env) return env

  if (parsed.data.categoryOverride) {
    const ov =
      ctx.scopeKey && ctx.order.scope_item_type_id
        ? await structurePatch(env.url, env.key, 'scope_item_types', `id=eq.${ctx.order.scope_item_type_id}`, { handover_category: category })
        : await structurePatch(env.url, env.key, 'nodes', `id=eq.${ctx.order.node_id}`, { handover_category: category })
    if (!ov.ok) return { error: ov.error ?? 'Failed to save the category choice' }
  }

  const folder = await ensureHandoverCategoryRoot(guard.supabase, guard.orgId, projectId, category, guard.user.id)
  if ('error' in folder) return folder

  const cleanFolderPath = (folder.folder_path || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  const displayName = buildHandoverDrawingName(ctx.order.label, ctx.drawing.file_name)
  const safeName = displayName.replace(/[^a-zA-Z0-9._ -]/g, '_')
  const handoverPath = `${folder.organisation_id}/${projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}`

  const { data: blob, error: dlErr } = await guard.supabase.storage.from(DRAWINGS_BUCKET).download(ctx.drawing.storage_path)
  if (dlErr || !blob) return { error: `Could not read the drawing file: ${dlErr?.message ?? 'missing'}` }

  const { error: upErr } = await guard.supabase.storage
    .from(HANDOVER_BUCKET)
    .upload(handoverPath, blob, { contentType: (blob as Blob).type || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `Could not copy the drawing into handover: ${upErr.message}` }

  const { data: docRow, error: insErr } = await (guard.supabase as any)
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: projectId,
      name: safeName,
      category: 'handover',
      storage_path: handoverPath,
      mime_type: (blob as Blob).type || null,
      size_bytes: (blob as Blob).size,
      handover_folder_id: folder.id,
      handover_category: category,
      uploaded_by: guard.user.id,
    })
    .select('id')
    .single()
  if (insErr || !docRow) {
    await guard.supabase.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    return { error: `Handover document insert failed: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }

  // Conditional on status='received' so a concurrent approve can't double-file.
  const patch = await structurePatchReturning(
    env.url,
    env.key,
    'node_order_shop_drawings',
    `id=eq.${drawingId}&status=eq.received`,
    {
      status: 'approved',
      approved_at: new Date().toISOString(),
      approved_by: guard.user.id,
      handover_document_id: (docRow as { id: string }).id,
      handover_category: category,
    },
  )
  if (!patch.ok || !patch.rows || patch.rows.length === 0) {
    // Hard failure OR we lost an approve race (another request already moved
    // this drawing past 'received'). Either way, undo the duplicate handover
    // artefacts this attempt created.
    await (guard.supabase as any).schema('tenants').from('documents').delete().eq('id', (docRow as { id: string }).id)
    await guard.supabase.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    // A lost race is not an error — the drawing is approved and filed already.
    return patch.ok ? { ok: true } : { error: patch.error ?? 'Failed to commit approval' }
  }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// revertShopDrawingAction — step status back one stage
// ---------------------------------------------------------------------------

export async function revertShopDrawingAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId, { requireManage: true })
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  const env = serviceEnv()
  if ('error' in env) return env

  if (ctx.drawing.status === 'approved') {
    if (ctx.drawing.handover_document_id) {
      const { data: doc } = await (guard.supabase as any)
        .schema('tenants').from('documents').select('storage_path').eq('id', ctx.drawing.handover_document_id).maybeSingle()
      await (guard.supabase as any)
        .schema('tenants').from('documents').delete().eq('id', ctx.drawing.handover_document_id)
      const path = (doc as { storage_path: string } | null)?.storage_path
      if (path) await guard.supabase.storage.from(HANDOVER_BUCKET).remove([path]).catch(() => undefined)
    }
    const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
      status: 'received', approved_at: null, approved_by: null, handover_document_id: null, handover_category: null,
    })
    if (!patch.ok) return { error: patch.error ?? 'Failed to revert approval' }
  } else if (ctx.drawing.status === 'received') {
    const patch = await structurePatch(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`, {
      status: 'awaiting', received_at: null,
    })
    if (!patch.ok) return { error: patch.error ?? 'Failed to revert' }
  } else {
    return { error: "Drawing is already 'awaiting'" }
  }

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// removeShopDrawingAction
// ---------------------------------------------------------------------------

export async function removeShopDrawingAction(
  projectId: string,
  drawingId: string,
): Promise<ShopDrawingStatusResult> {
  const parsed = z.object({ projectId: uuidSchema, drawingId: uuidSchema }).safeParse({ projectId, drawingId })
  if (!parsed.success) return { error: parsed.error.errors[0]?.message ?? 'Invalid input' }

  const guard = await guardProjectAccess(projectId, { requireManage: true })
  if (guard.error !== undefined) return { error: guard.error }

  const loaded = await loadDrawingContext(guard.supabase, drawingId, projectId)
  if ('error' in loaded) return loaded
  const { ctx } = loaded

  const env = serviceEnv()
  if ('error' in env) return env

  if (ctx.drawing.handover_document_id) {
    const { data: doc } = await (guard.supabase as any)
      .schema('tenants').from('documents').select('storage_path').eq('id', ctx.drawing.handover_document_id).maybeSingle()
    await (guard.supabase as any)
      .schema('tenants').from('documents').delete().eq('id', ctx.drawing.handover_document_id)
    const hPath = (doc as { storage_path: string } | null)?.storage_path
    if (hPath) await guard.supabase.storage.from(HANDOVER_BUCKET).remove([hPath]).catch(() => undefined)
  }

  const del = await structureDelete(env.url, env.key, 'node_order_shop_drawings', `id=eq.${drawingId}`)
  if (!del.ok) return { error: del.error ?? 'Failed to remove drawing' }
  await guard.supabase.storage.from(DRAWINGS_BUCKET).remove([ctx.drawing.storage_path]).catch(() => undefined)

  revalidate(projectId)
  return { ok: true }
}

// ---------------------------------------------------------------------------
// getShopDrawingSignedUrlAction
// ---------------------------------------------------------------------------

export type SignedUrlResult = { url: string } | { error: string }

export async function getShopDrawingSignedUrlAction(
  projectId: string,
  storagePath: string,
  downloadName?: string,
): Promise<SignedUrlResult> {
  const parsed = z.object({ projectId: uuidSchema, storagePath: z.string().min(1) }).safeParse({ projectId, storagePath })
  if (!parsed.success) return { error: 'Invalid input' }

  const guard = await guardProjectAccess(projectId)
  if (guard.error !== undefined) return { error: guard.error }

  // downloadName set → Content-Disposition: attachment; omitted → inline preview.
  const { data, error } = await guard.supabase.storage.from(DRAWINGS_BUCKET).createSignedUrl(storagePath, 300, downloadName ? { download: downloadName } : undefined)
  if (error || !data?.signedUrl) return { error: error?.message ?? 'Could not generate signed URL' }
  return { url: data.signedUrl }
}
