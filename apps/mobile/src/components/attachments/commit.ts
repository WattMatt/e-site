import { storageService } from '@esite/shared'
import type { TypedSupabaseClient } from '@esite/db'
import type { AttachmentEntityType, StagedAttachment, AnnotationData } from './types'

export interface CommitArgs {
  client: TypedSupabaseClient
  staged: StagedAttachment[]
  orgId: string
  projectId: string
  entityType: AttachmentEntityType
  entityId: string
  rfiId: string
  userId: string
}

export async function commitStagedAttachments({
  client, staged, orgId, projectId, entityType, entityId, rfiId, userId,
}: CommitArgs): Promise<void> {
  if (staged.length === 0) return

  for (let i = 0; i < staged.length; i++) {
    const item = staged[i]!
    const safeName = sanitise(item.fileName)
    const path = storageService.rfiAttachmentPath(
      orgId, projectId, rfiId, `${Date.now()}-${i}-${safeName}`,
    )

    await storageService.uploadFromUri(
      client, 'rfi-attachments', path, item.uri, item.mimeType,
    )

    const { data: attachment, error: rowErr } = await client
      .from('attachments')
      .insert({
        organisation_id: orgId,
        entity_type: entityType,
        entity_id: entityId,
        file_path: path,
        file_name: item.fileName,
        mime_type: item.mimeType,
        sort_order: i,
        uploaded_by: userId,
      })
      .select('id')
      .single()

    if (rowErr || !attachment) {
      await storageService.remove(client, 'rfi-attachments', [path]).catch(() => undefined)
      throw new Error(`Could not record attachment: ${rowErr?.message ?? 'unknown'}`)
    }

    if (item.kind === 'annotation') {
      const { error: annErr } = await client
        .from('rfi_annotations')
        .insert({
          organisation_id: orgId,
          attachment_id: attachment.id,
          source_floor_plan_id: item.sourceFloorPlanId,
          annotation_data: item.annotationData as unknown as import('@esite/db').Json,
          created_by: userId,
        })
      if (annErr) {
        console.warn('[rfi] annotation insert failed:', annErr.message)
      }
    }
  }
}

export async function replaceAnnotation({
  client, attachmentId, annotationId, uri, annotationData,
}: {
  client: TypedSupabaseClient
  attachmentId: string
  annotationId: string
  uri: string
  annotationData: AnnotationData
}): Promise<void> {
  const { data: row, error } = await client
    .from('attachments')
    .select('file_path')
    .eq('id', attachmentId)
    .single()
  if (error || !row) throw new Error(`Attachment not found: ${error?.message ?? attachmentId}`)

  const response = await fetch(uri)
  const blob = await response.blob()
  const { error: upErr } = await client.storage
    .from('rfi-attachments')
    .upload(row.file_path, blob, { contentType: 'image/png', upsert: true })
  if (upErr) throw new Error(`Re-upload failed: ${upErr.message}`)

  const { error: annErr } = await client
    .from('rfi_annotations')
    .update({ annotation_data: annotationData as unknown as import('@esite/db').Json })
    .eq('id', annotationId)
  if (annErr) throw new Error(annErr.message)
}

export async function deleteAttachment({
  client, attachmentId, filePath,
}: {
  client: TypedSupabaseClient
  attachmentId: string
  filePath: string
}): Promise<void> {
  const { error } = await client.from('attachments').delete().eq('id', attachmentId)
  if (error) throw new Error(error.message)
  await storageService.remove(client, 'rfi-attachments', [filePath]).catch(() => undefined)
}

export async function fetchAttachments(
  client: TypedSupabaseClient,
  entityType: AttachmentEntityType,
  entityId: string,
): Promise<import('./types').PersistedAttachment[]> {
  const { data, error } = await client
    .from('attachments')
    .select(`
      id, file_path, file_name, mime_type, file_size_bytes,
      caption, sort_order, created_at,
      annotation:rfi_annotations (
        id, source_floor_plan_id, annotation_data
      )
    `)
    .eq('entity_type', entityType)
    .eq('entity_id', entityId)
    .order('sort_order', { ascending: true })
    .order('created_at', { ascending: true })

  if (error) return []

  const rows = (data ?? []) as any[]
  const signed = await Promise.all(
    rows.map(async r => {
      const { data: s } = await client.storage
        .from('rfi-attachments')
        .createSignedUrl(r.file_path, 60 * 60)
      const annRaw = Array.isArray(r.annotation) ? r.annotation[0] : r.annotation
      const annotation = annRaw
        ? {
            id: annRaw.id,
            source_floor_plan_id: annRaw.source_floor_plan_id,
            annotation_data: annRaw.annotation_data as AnnotationData,
          }
        : undefined
      return {
        id: r.id,
        file_path: r.file_path,
        file_name: r.file_name,
        mime_type: r.mime_type,
        file_size_bytes: r.file_size_bytes,
        caption: r.caption,
        sort_order: r.sort_order,
        created_at: r.created_at,
        signedUrl: s?.signedUrl ?? null,
        annotation,
      }
    }),
  )
  return signed
}

function sanitise(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, '_').slice(0, 80) || 'file'
}
