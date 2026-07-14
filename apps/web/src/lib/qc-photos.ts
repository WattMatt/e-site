import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnotationData } from '@/components/attachments/types'

export const QC_PHOTO_MAX_BYTES = 20971520 // 20 MiB — the qc-report-entries bucket cap

const QC_ENTRIES_BUCKET = 'qc-report-entries'

/** Everything needed to place an upload under its entry's storage folder. */
export interface QcUploadTarget {
  orgId: string
  projectId: string
  reportId: string
  entryId: string
  userId: string
}

/**
 * Downscale + re-encode a captured photo before upload.
 *
 * Copy of the canonical compressImage in useFieldPhotos.ts (deliberately
 * inlined, like the branding forms, to avoid client-bundle coupling): resize
 * to 2048 px wide, JPEG q0.85, `imageOrientation: 'from-image'` bakes EXIF
 * rotation into the pixels. Any failure falls back to the original file so a
 * capture is never silently dropped — the bucket's 20 MB cap is the only hard
 * limit on that path.
 */
async function compressImage(file: File): Promise<File> {
  const MAX_WIDTH = 2048
  const QUALITY = 0.85

  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' })

    const scale = Math.min(1, MAX_WIDTH / bitmap.width)
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return file
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const blob = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/jpeg', QUALITY),
    )
    // Keep the original if encoding failed or didn't actually shrink it.
    if (!blob || blob.size >= file.size) return file

    return new File([blob], file.name.replace(/\.[^.]+$/, '') + '.jpg', {
      type: 'image/jpeg',
    })
  } catch {
    return file
  } finally {
    bitmap?.close()
  }
}

/**
 * Uploads photos to the qc-report-entries bucket and inserts qc_entry_photos
 * rows — client-direct under the user's session (diary uploadDiaryAttachments
 * pattern; bucket + table RLS are the gates, no Vercel body cap in the path).
 *
 * `onFileUploaded` fires after each file's row is committed. The caller uses it
 * to drop committed files from its pending list, so a retry after a mid-loop
 * failure resumes with only the not-yet-uploaded files (no duplicate rows).
 */
export async function uploadQcEntryPhotos(
  supabase: SupabaseClient,
  opts: QcUploadTarget & { files: File[] },
  onFileUploaded?: (file: File) => void,
): Promise<void> {
  const { files } = opts
  // Continue sort_order after any photos the entry already has. Without this a
  // retry (remaining files only) or an "add more" on an existing entry would
  // restart at 0 and collide with committed rows, scrambling display order.
  const baseSort = await nextSortOrder(supabase, opts.entryId)
  for (let i = 0; i < files.length; i++) {
    const raw = files[i]
    const file = await compressImage(raw)
    if (file.size > QC_PHOTO_MAX_BYTES) {
      throw new Error(`"${raw.name}" exceeds the 20 MB limit.`)
    }
    const seq = baseSort + i
    const ext = file.name.split('.').pop() ?? 'jpg'
    await uploadAndInsert(supabase, opts, {
      body: file,
      contentType: file.type,
      ext,
      seq,
      fileName: raw.name,
      sizeBytes: file.size,
      kind: 'photo',
    })
    onFileUploaded?.(raw)
  }
}

/**
 * Uploads a staged drawing markup (flattened PNG from FloorPlanAttachDialog)
 * as a qc_entry_photos row with kind='markup'. The vector scene graph is kept
 * in annotation_data so the markup stays re-editable.
 */
export async function uploadQcMarkup(
  supabase: SupabaseClient,
  target: QcUploadTarget,
  markup: {
    blob: Blob
    fileName: string
    annotationData: AnnotationData
    sourceFloorPlanId: string | null
  },
): Promise<void> {
  if (markup.blob.size > QC_PHOTO_MAX_BYTES) {
    throw new Error(`"${markup.fileName}" exceeds the 20 MB limit.`)
  }
  const seq = await nextSortOrder(supabase, target.entryId)
  await uploadAndInsert(supabase, target, {
    body: markup.blob,
    contentType: 'image/png',
    ext: 'png',
    seq,
    fileName: markup.fileName,
    sizeBytes: markup.blob.size,
    kind: 'markup',
    sourceFloorPlanId: markup.sourceFloorPlanId,
    annotationData: markup.annotationData,
  })
}

/**
 * Overwrite an existing drawing markup in place — the QC entry card's
 * "Edit markup" flow (spec §4 re-edit). Mirrors the RFI gallery's
 * replaceAnnotation (components/attachments/commit.ts): the new flattened PNG
 * replaces the stored object at the SAME file_path (upsert:true — the storage
 * UPDATE policy is the gate), then the row's annotation_data +
 * file_size_bytes are updated under RLS. Same row, same path, so per-photo
 * comments and "Photo N" numbering keep pointing at the right image; the
 * caller must router.refresh() so re-signed URLs bust the stale thumbnail.
 */
export async function replaceQcMarkup(
  supabase: SupabaseClient,
  photo: { id: string; filePath: string },
  markup: { blob: Blob; annotationData: AnnotationData },
): Promise<void> {
  if (markup.blob.size > QC_PHOTO_MAX_BYTES) {
    throw new Error('The markup exceeds the 20 MB limit.')
  }
  const { error: upErr } = await supabase.storage
    .from(QC_ENTRIES_BUCKET)
    .upload(photo.filePath, markup.blob, { contentType: 'image/png', upsert: true })
  if (upErr) throw new Error(`Re-upload failed: ${upErr.message}`)

  const { error: rowErr } = await (supabase as any)
    .schema('projects')
    .from('qc_entry_photos')
    .update({
      annotation_data: markup.annotationData,
      file_size_bytes: markup.blob.size,
    })
    .eq('id', photo.id)
  if (rowErr) throw new Error(`Could not update markup: ${rowErr.message}`)
}

/** Shared upload → row-insert step with orphan-blob cleanup on row failure. */
async function uploadAndInsert(
  supabase: SupabaseClient,
  target: QcUploadTarget,
  item: {
    body: Blob
    contentType: string
    ext: string
    seq: number
    fileName: string
    sizeBytes: number
    kind: 'photo' | 'markup'
    sourceFloorPlanId?: string | null
    annotationData?: AnnotationData
  },
): Promise<void> {
  const { orgId, projectId, reportId, entryId, userId } = target
  const path = `${orgId}/${projectId}/${reportId}/${entryId}/${Date.now()}-${item.seq}.${item.ext}`
  const { error: upErr } = await supabase.storage
    .from(QC_ENTRIES_BUCKET)
    .upload(path, item.body, { contentType: item.contentType })
  if (upErr) throw upErr
  // qc_entry_photos is not in the generated DB types — cast, diary-style.
  const { error: rowErr } = await (supabase as any)
    .schema('projects')
    .from('qc_entry_photos')
    .insert({
      entry_id: entryId,
      organisation_id: orgId,
      project_id: projectId,
      file_path: path,
      file_name: item.fileName,
      mime_type: item.contentType,
      file_size_bytes: item.sizeBytes,
      sort_order: item.seq,
      kind: item.kind,
      source_floor_plan_id: item.sourceFloorPlanId ?? null,
      annotation_data: item.annotationData ?? null,
      uploaded_by: userId,
    })
  if (rowErr) {
    // The object uploaded but the row insert failed — remove the orphan.
    await supabase.storage.from(QC_ENTRIES_BUCKET).remove([path]).catch(() => {})
    throw rowErr
  }
}

/** Next free sort_order for an entry (max existing + 1, or 0 when none). */
async function nextSortOrder(supabase: SupabaseClient, entryId: string): Promise<number> {
  const { data } = await (supabase as any)
    .schema('projects')
    .from('qc_entry_photos')
    .select('sort_order')
    .eq('entry_id', entryId)
    .order('sort_order', { ascending: false })
    .limit(1)
  return ((data?.[0]?.sort_order as number | undefined) ?? -1) + 1
}
