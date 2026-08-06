/**
 * Client-side image compression for photo uploads.
 *
 * Extracted so the snag capture paths share one implementation instead of
 * inlining a fourth copy of the canvas-resize helper. Kept dependency-free and
 * side-effect-free so importing it into a client component costs nothing beyond
 * these few lines.
 *
 * Falls back to the original File on any failure (no canvas, decode error, or a
 * "compressed" result that came out larger) — a photo that uploads slightly big
 * beats a photo that doesn't upload.
 */

const MAX_WIDTH = 2048
const QUALITY = 0.85

export async function compressImage(file: File): Promise<File> {
  if (!file.type.startsWith('image/')) return file
  if (typeof createImageBitmap !== 'function') return file

  let bitmap: ImageBitmap | null = null
  try {
    // imageOrientation:'from-image' bakes EXIF rotation into the pixels, so
    // phone photos don't arrive sideways in the PDF.
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
 * Upload one snag photo and write its row, cleaning up the storage object if
 * the row write fails.
 *
 * The ordering matters: the bucket accepts the object before the table applies
 * its CHECK/RLS, so a failed insert would otherwise strand a file nobody can
 * reach — exactly how the `photo_type:'defect'` bug filled the bucket with
 * orphans while leaving field.snag_photos empty.
 */
export async function uploadSnagPhoto(
  supabase: {
    storage: { from: (b: string) => { upload: (p: string, f: File, o?: unknown) => Promise<{ error: { message: string } | null }>; remove: (p: string[]) => Promise<unknown> } }
    schema: (s: string) => { from: (t: string) => { insert: (row: Record<string, unknown>) => Promise<{ error: { message: string } | null }> } }
  },
  opts: {
    file: File
    orgId: string
    projectId: string
    snagId: string
    photoType: 'evidence' | 'closeout' | 'markup'
    sortOrder: number
    uploadedBy: string | null
    visitId?: string | null
    caption?: string | null
  },
): Promise<void> {
  const prepared = await compressImage(opts.file)
  const ext = prepared.name.split('.').pop() ?? 'jpg'
  const path = `${opts.orgId}/${opts.projectId}/${opts.snagId}/${Date.now()}-${opts.sortOrder}.${ext}`

  const { error: upErr } = await supabase.storage
    .from('snag-photos')
    .upload(path, prepared, { contentType: prepared.type })
  if (upErr) throw new Error(upErr.message)

  const { error: insErr } = await supabase.schema('field').from('snag_photos').insert({
    snag_id: opts.snagId,
    file_path: path,
    caption: opts.caption ?? opts.file.name,
    photo_type: opts.photoType,
    sort_order: opts.sortOrder,
    uploaded_by: opts.uploadedBy,
    ...(opts.visitId ? { visit_id: opts.visitId } : {}),
  })
  if (insErr) {
    await supabase.storage.from('snag-photos').remove([path])
    throw new Error(insErr.message)
  }
}
