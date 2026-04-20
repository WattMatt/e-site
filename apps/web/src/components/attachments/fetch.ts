import type { SupabaseClient } from '@supabase/supabase-js'
import type { AttachmentEntityType, PersistedAttachment, AnnotationData } from './types'

/**
 * Server-side fetch. Returns attachments for a given entity with signed URLs
 * and (for annotation-linked PNGs) the joined scene graph so the client can
 * re-open them in the annotator.
 */
export async function fetchAttachments(
  supabase: SupabaseClient<any>,
  entityType: AttachmentEntityType,
  entityId: string,
  bucket = 'rfi-attachments',
): Promise<PersistedAttachment[]> {
  const { data, error } = await supabase
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
      const { data: s } = await supabase.storage
        .from(bucket)
        .createSignedUrl(r.file_path, 60 * 60)
      // Supabase may return `annotation` as array or single — normalise.
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
      } satisfies PersistedAttachment
    }),
  )
  return signed
}
