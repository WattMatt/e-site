import type { SupabaseClient } from '@supabase/supabase-js'
import type { AnnotationData } from '@/components/attachments/types'
import type { SceneGraph } from '@/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas'

export const QC_PHOTO_MAX_BYTES = 20971520 // 20 MiB — the qc-report-entries bucket cap

/**
 * A markup's stored vector data. QC markups now persist the full MarkupCanvas
 * `SceneGraph` (14 shape types, symbols, tables, measure); the legacy simple
 * annotator's `AnnotationData` (7 shapes) is kept in the union so pre-existing
 * rows still type-check on read. The JSONB column is untyped either way — this
 * union only guards the callers. Use `toSceneGraph` to normalise on read.
 */
export type QcMarkupData = AnnotationData | SceneGraph

/**
 * Normalise a stored `annotation_data` value into a `SceneGraph` for the full
 * MarkupCanvas (re-edit hydration). New QC markups are already SceneGraphs and
 * pass straight through; the rare legacy `AnnotationData` row (feature is days
 * old) is converted shape-by-shape. Detection keys off the canvas shape:
 * SceneGraph uses `canvas.w`/`canvas.h`, legacy AnnotationData uses
 * `canvas.width`/`canvas.height`.
 */
export function toSceneGraph(data: QcMarkupData): SceneGraph {
  const canvas = (data as { canvas?: { w?: unknown; width?: unknown } }).canvas
  // Already a SceneGraph — pass through untouched.
  if (canvas && typeof canvas.w === 'number') {
    return data as SceneGraph
  }
  const legacy = data as AnnotationData
  const shapes: SceneGraph['shapes'] = (legacy.shapes ?? []).map((s): SceneGraph['shapes'][number] => {
    switch (s.type) {
      case 'pen':
        return { id: s.id, type: 'pen', points: s.points, color: s.color, strokeWidth: s.strokeWidth }
      case 'arrow':
        return { id: s.id, type: 'arrow', points: s.points, color: s.color, strokeWidth: s.strokeWidth }
      case 'rect':
        return { id: s.id, type: 'rect', x: s.x, y: s.y, width: s.width, height: s.height, color: s.color, strokeWidth: s.strokeWidth }
      case 'circle':
        // The full canvas has no circle primitive — map to an equal-radii ellipse.
        return { id: s.id, type: 'ellipse', cx: s.x, cy: s.y, rx: s.radius, ry: s.radius, color: s.color, strokeWidth: s.strokeWidth }
      case 'text':
        return { id: s.id, type: 'text', x: s.x, y: s.y, text: s.text, fontSize: s.fontSize, color: s.color }
      case 'pin':
        // SceneGraph pins require a label; legacy pins made it optional.
        return { id: s.id, type: 'pin', x: s.x, y: s.y, label: s.label ?? '', color: s.color }
    }
  })
  return {
    version: 1,
    canvas: { w: legacy.canvas?.width ?? 0, h: legacy.canvas?.height ?? 0 },
    shapes,
  }
}

const QC_ENTRIES_BUCKET = 'qc-report-entries'

/**
 * A flattened markup PNG above this size is downscaled before upload. It stays
 * well under the bucket's 20 MB hard cap (QC_PHOTO_MAX_BYTES) — the raster is
 * display-only (the editable SceneGraph is stored separately in
 * annotation_data), so a lossy re-encode is safe and keeps thumbnails/PDF
 * embeds light.
 */
export const QC_MARKUP_DOWNSCALE_THRESHOLD = 3 * 1024 * 1024 // ~3 MB
/** Longest-edge ceiling a downscaled markup is resized to. */
export const QC_MARKUP_MAX_EDGE = 3000

/**
 * Downscale + re-encode a raster blob so its longest edge is ≤ maxEdge. Mirrors
 * compressImage (canvas resize + toBlob), but targets a longest-edge ceiling
 * (markups can be portrait or landscape) and re-encodes PNG (markups are line
 * art over a plan — PNG keeps the strokes crisp). Any failure — non-image,
 * missing createImageBitmap (SSR/tests), decode error, or an encode that didn't
 * actually shrink the bytes — falls back to the original blob, so a markup is
 * never silently dropped; the 20 MB cap is the only hard limit on that path.
 */
export async function downscaleImageBlob(
  blob: Blob,
  opts?: { maxEdge?: number },
): Promise<Blob> {
  const maxEdge = opts?.maxEdge ?? QC_MARKUP_MAX_EDGE
  if (!blob.type.startsWith('image/')) return blob
  if (typeof createImageBitmap !== 'function') return blob

  let bitmap: ImageBitmap | null = null
  try {
    bitmap = await createImageBitmap(blob)
    const longest = Math.max(bitmap.width, bitmap.height)
    const scale = Math.min(1, maxEdge / longest)
    // Already within bounds — nothing to gain from a re-encode.
    if (scale >= 1) return blob

    const canvas = document.createElement('canvas')
    canvas.width = Math.round(bitmap.width * scale)
    canvas.height = Math.round(bitmap.height * scale)
    const ctx = canvas.getContext('2d')
    if (!ctx) return blob
    ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height)

    const out = await new Promise<Blob | null>((resolve) =>
      canvas.toBlob(resolve, 'image/png'),
    )
    // Keep the original if encoding failed or didn't actually shrink it.
    if (!out || out.size >= blob.size) return blob
    return out
  } catch {
    return blob
  } finally {
    bitmap?.close()
  }
}

/**
 * Prepare a flattened markup blob for upload: downscale it when it exceeds the
 * soft threshold (S3), then enforce the 20 MB bucket cap as the final backstop.
 * `label` is interpolated into the cap error so the caller surfaces which file.
 */
async function prepareMarkupBlob(blob: Blob, label: string): Promise<Blob> {
  const out =
    blob.size > QC_MARKUP_DOWNSCALE_THRESHOLD ? await downscaleImageBlob(blob) : blob
  if (out.size > QC_PHOTO_MAX_BYTES) {
    throw new Error(`${label} exceeds the 20 MB limit even after downscaling.`)
  }
  return out
}

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
    annotationData: QcMarkupData
    sourceFloorPlanId: string | null
  },
): Promise<void> {
  // Downscale-if-large (S3) then cap-backstop, before touching storage.
  const body = await prepareMarkupBlob(markup.blob, `"${markup.fileName}"`)
  const seq = await nextSortOrder(supabase, target.entryId)
  await uploadAndInsert(supabase, target, {
    body,
    contentType: 'image/png',
    ext: 'png',
    seq,
    fileName: markup.fileName,
    sizeBytes: body.size,
    kind: 'markup',
    sourceFloorPlanId: markup.sourceFloorPlanId,
    annotationData: markup.annotationData,
  })
}

/**
 * Overwrite an existing drawing markup — the QC entry card's "Edit markup" flow
 * (spec §4 re-edit). ORDER-SAFE swap (Defect B1): the new flattened PNG is
 * uploaded to a NEW timestamped file_path in the same entry folder (upsert:false
 * — the original object is never overwritten), then the row is repointed at it
 * (file_path + annotation_data + file_size_bytes). The row stays the same id, so
 * per-photo comments and "Photo N" numbering keep pointing at the right photo;
 * the caller must router.refresh() so the freshly signed URL busts the stale
 * thumbnail. Failure never destroys the original: a rejected row update (e.g.
 * the closed-report freeze) cleans up the new blob and leaves the old object +
 * row intact; the old object is removed (best-effort) only AFTER the row commits
 * to the new path.
 */
export async function replaceQcMarkup(
  supabase: SupabaseClient,
  photo: { id: string; filePath: string },
  markup: { blob: Blob; annotationData: QcMarkupData },
): Promise<void> {
  // Downscale-if-large (S3) then cap-backstop.
  const body = await prepareMarkupBlob(markup.blob, 'The markup')

  // Same entry folder (so the path-prefix RLS still matches), new object name.
  const slash = photo.filePath.lastIndexOf('/')
  const dir = slash >= 0 ? photo.filePath.slice(0, slash) : ''
  const newPath = `${dir ? `${dir}/` : ''}${Date.now()}-${Math.floor(Math.random() * 1e6)}.png`

  // 1. Upload to the NEW path (upsert:false — the original object is untouched).
  const { error: upErr } = await supabase.storage
    .from(QC_ENTRIES_BUCKET)
    .upload(newPath, body, { contentType: 'image/png', upsert: false })
  if (upErr) throw new Error(`Re-upload failed: ${upErr.message}`)

  // 2. Repoint the row at the new object.
  const { error: rowErr } = await (supabase as any)
    .schema('projects')
    .from('qc_entry_photos')
    .update({
      file_path: newPath,
      annotation_data: markup.annotationData,
      file_size_bytes: body.size,
    })
    .eq('id', photo.id)
  if (rowErr) {
    // Row rejected (closed-report freeze / RLS) — bin the new blob, leave the
    // original object + row exactly as they were.
    await supabase.storage.from(QC_ENTRIES_BUCKET).remove([newPath]).catch(() => {})
    throw new Error(`Could not update markup: ${rowErr.message}`)
  }

  // 3. Row now points at newPath — best-effort remove the old orphan.
  await supabase.storage.from(QC_ENTRIES_BUCKET).remove([photo.filePath]).catch(() => {})
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
    annotationData?: QcMarkupData
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
