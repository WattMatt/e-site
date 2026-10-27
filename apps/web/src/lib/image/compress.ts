import { prepareImageForUpload } from './prepare'

/**
 * Prepares a photo for upload: any format a phone or tablet supplies (HEIC included) comes back as
 * a JPEG with the rotation baked in and the long edge capped. See prepare.ts.
 *
 * It used to fall back to the ORIGINAL file on any failure, which is how an iPhone HEIC reached
 * storage in a format only Safari can show. It now throws ImageUnreadableError with a sentence for
 * the person instead: a refusal they can act on beats a photo nobody else can see.
 */
export async function compressImage(file: File): Promise<File> {
  return (await prepareImageForUpload(file)).file
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
