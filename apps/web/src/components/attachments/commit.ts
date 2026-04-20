// Client-side helper — uploads a list of StagedAttachment items to the
// rfi-attachments storage bucket and inserts the corresponding
// public.attachments + public.rfi_annotations rows. Used by RFI create / respond
// flows after the parent row is inserted (we need the parent id first).

import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentEntityType, StagedAttachment } from './types'

export interface CommitArgs {
  supabase: SupabaseClient<any>
  staged: StagedAttachment[]
  orgId: string
  projectId: string
  entityType: AttachmentEntityType
  entityId: string
  // Required for bucket path; RFI responses bucket-path by parent RFI id.
  rfiId: string
  userId: string
  bucket?: string
}

export async function commitStagedAttachments({
  supabase, staged, orgId, projectId, entityType, entityId, rfiId, userId,
  bucket = 'rfi-attachments',
}: CommitArgs): Promise<void> {
  if (staged.length === 0) return

  for (let i = 0; i < staged.length; i++) {
    const item = staged[i]!
    const safeName = sanitise(
      item.kind === 'file' ? item.file.name : item.fileName,
    )
    const path = `${orgId}/${projectId}/${rfiId}/${Date.now()}-${i}-${safeName}`

    const blob  = item.kind === 'file' ? item.file : item.blob
    const mime  = item.kind === 'file' ? (item.file.type || 'application/octet-stream') : 'image/png'
    const size  = item.kind === 'file' ? item.file.size : item.blob.size

    const { error: upErr } = await supabase.storage
      .from(bucket)
      .upload(path, blob, { contentType: mime, upsert: false })
    if (upErr) throw new Error(`Upload failed (${safeName}): ${upErr.message}`)

    const { data: attachment, error: rowErr } = await supabase
      .from('attachments')
      .insert({
        organisation_id: orgId,
        entity_type: entityType,
        entity_id: entityId,
        file_path: path,
        file_name: item.kind === 'file' ? item.file.name : item.fileName,
        file_size_bytes: size,
        mime_type: mime,
        sort_order: i,
        uploaded_by: userId,
      })
      .select('id')
      .single()

    if (rowErr || !attachment) {
      // Best-effort rollback of the orphan object.
      await supabase.storage.from(bucket).remove([path]).catch(() => undefined)
      throw new Error(`Could not record attachment: ${rowErr?.message ?? 'unknown error'}`)
    }

    if (item.kind === 'annotation') {
      const { error: annErr } = await supabase
        .from('rfi_annotations')
        .insert({
          organisation_id: orgId,
          attachment_id: attachment.id,
          source_floor_plan_id: item.sourceFloorPlanId,
          annotation_data: item.annotationData,
          created_by: userId,
        })
      if (annErr) {
        // Leave the attachment row but flag — annotation failure shouldn't
        // lose the uploaded markup PNG. The user still has the composited image.
        console.warn('Annotation metadata insert failed:', annErr.message)
      }
    }
  }
}

/**
 * Overwrite an existing annotation — used when the user re-edits markup from
 * the detail gallery. Replaces the stored PNG in place and updates the
 * rfi_annotations row's scene graph.
 */
export async function replaceAnnotation({
  supabase,
  attachmentId,
  annotationId,
  blob,
  annotationData,
  bucket = 'rfi-attachments',
}: {
  supabase: SupabaseClient<any>
  attachmentId: string
  annotationId: string
  blob: Blob
  annotationData: import('./types').AnnotationData
  bucket?: string
}): Promise<void> {
  const { data: row, error } = await supabase
    .from('attachments')
    .select('file_path')
    .eq('id', attachmentId)
    .single()
  if (error || !row) throw new Error(`Attachment not found: ${error?.message ?? attachmentId}`)

  const { error: upErr } = await supabase.storage
    .from(bucket)
    .upload(row.file_path, blob, { contentType: 'image/png', upsert: true })
  if (upErr) throw new Error(`Re-upload failed: ${upErr.message}`)

  const { error: annErr } = await supabase
    .from('rfi_annotations')
    .update({ annotation_data: annotationData })
    .eq('id', annotationId)
  if (annErr) throw new Error(`Could not update annotation: ${annErr.message}`)
}

export async function deleteAttachment({
  supabase, attachmentId, filePath, bucket = 'rfi-attachments',
}: {
  supabase: SupabaseClient<any>
  attachmentId: string
  filePath: string
  bucket?: string
}): Promise<void> {
  // Row delete cascades to rfi_annotations via FK ON DELETE CASCADE.
  const { error: rowErr } = await supabase.from('attachments').delete().eq('id', attachmentId)
  if (rowErr) throw new Error(rowErr.message)
  await supabase.storage.from(bucket).remove([filePath]).catch(() => undefined)
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file'
}
