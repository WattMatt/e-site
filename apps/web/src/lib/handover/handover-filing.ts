/**
 * Shared handover-filing primitives.
 *
 * - ensureHandoverCategoryRoot: find-or-create a category's root folder.
 *   Moved verbatim from node-order-shop-drawing.actions.ts so it can be reused
 *   by the inspection report worker (a 'use server' file cannot export it).
 * - fileIntoHandover: copy bytes into project-documents at the handover path
 *   and insert a tenants.documents row, tagged with (origin_kind, origin_id).
 *
 * NOT a 'use server' module — callers pass an already-resolved client
 * (service-role for RLS-bypassing writes, or a cookie client where RLS allows).
 */
import { CATEGORY_LABELS, type HandoverCategory } from '@esite/shared'

/* eslint-disable @typescript-eslint/no-explicit-any */
type AnyClient = any

const HANDOVER_BUCKET = 'project-documents'

/** Find or create the category root handover folder; returns its id + path + org. */
export async function ensureHandoverCategoryRoot(
  client: AnyClient,
  orgId: string,
  projectId: string,
  category: HandoverCategory,
  userId: string,
): Promise<{ id: string; folder_path: string; organisation_id: string } | { error: string }> {
  const { data: existing } = await client
    .schema('tenants')
    .from('handover_folders')
    .select('id, folder_path, organisation_id')
    .eq('project_id', projectId)
    .eq('category', category)
    .is('parent_folder_id', null)
    .maybeSingle()
  if (existing) return existing as { id: string; folder_path: string; organisation_id: string }

  const { data: inserted, error } = await client
    .schema('tenants')
    .from('handover_folders')
    .insert({
      organisation_id: orgId,
      project_id: projectId,
      parent_folder_id: null,
      name: CATEGORY_LABELS[category],
      category,
      cloud_provider: null,
      cloud_folder_id: null,
      cloud_folder_path: null,
      cloud_synced_at: null,
      created_by: userId,
    })
    .select('id, folder_path, organisation_id')
    .single()
  if (error || !inserted) {
    return { error: `Failed to create handover folder: ${(error as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  return inserted as { id: string; folder_path: string; organisation_id: string }
}

export interface FileIntoHandoverOpts {
  orgId: string
  projectId: string
  category: HandoverCategory
  name: string
  bytes: Uint8Array
  mimeType: string | null
  originKind: string
  originId: string
  userId: string
}

/**
 * Copy bytes into the handover pack under `category` and record a
 * tenants.documents row. Best-effort rollback of the storage blob if the
 * row insert fails. Returns { documentId } or { error }.
 */
export async function fileIntoHandover(
  client: AnyClient,
  opts: FileIntoHandoverOpts,
): Promise<{ documentId: string } | { error: string }> {
  const folder = await ensureHandoverCategoryRoot(client, opts.orgId, opts.projectId, opts.category, opts.userId)
  if ('error' in folder) return folder

  const cleanFolderPath = (folder.folder_path || '').replace(/^\/+/, '').replace(/\/+/g, '/')
  const safeName = opts.name.replace(/[^a-zA-Z0-9._ -]/g, '_').slice(0, 200) || 'document'
  const handoverPath = `${folder.organisation_id}/${opts.projectId}/handover/${cleanFolderPath}/${Date.now()}-${safeName}`

  const { error: upErr } = await client.storage
    .from(HANDOVER_BUCKET)
    .upload(handoverPath, opts.bytes, { contentType: opts.mimeType || 'application/octet-stream', upsert: false })
  if (upErr) return { error: `Could not copy into handover: ${upErr.message}` }

  const { data: docRow, error: insErr } = await client
    .schema('tenants')
    .from('documents')
    .insert({
      organisation_id: folder.organisation_id,
      project_id: opts.projectId,
      name: safeName,
      category: 'handover',
      storage_path: handoverPath,
      mime_type: opts.mimeType,
      size_bytes: opts.bytes.byteLength,
      handover_folder_id: folder.id,
      handover_category: opts.category,
      origin_kind: opts.originKind,
      origin_id: opts.originId,
      uploaded_by: opts.userId,
    })
    .select('id')
    .single()
  if (insErr || !docRow) {
    await client.storage.from(HANDOVER_BUCKET).remove([handoverPath]).catch(() => undefined)
    return { error: `Handover document insert failed: ${(insErr as { message?: string } | null)?.message ?? 'unknown'}` }
  }
  return { documentId: (docRow as { id: string }).id }
}
