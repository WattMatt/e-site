/**
 * Client-side upload of site-form photos and signatures.
 *
 * PATH LAYOUT IS LOAD-BEARING. Migration 00179's storage policies gate every
 * object on `(storage.foldername(name))[2]::uuid` being the FORM id:
 *
 *   photos:     {project_id}/{form_id}/{section_id}/{field_id}/{ts}-{n}.{ext}
 *   signatures: {project_id}/{form_id}/signatures/{block_id}/{ts}.png
 *
 * Note this deliberately differs from the snag module, which puts the org id
 * first. Copying that layout here would put the project id in segment 2 and
 * every upload would be silently denied by RLS.
 *
 * Both helpers are orphan-safe: the bucket accepts the object before the table
 * applies its CHECK and RLS, so a failed insert would strand a file nobody can
 * reach. That is exactly how the snag `photo_type:'defect'` bug filled a bucket
 * with unreachable objects while leaving the table empty.
 */

import { compressImage } from '@/lib/image/compress'

type UploadClient = {
  storage: {
    from: (b: string) => {
      upload: (
        p: string,
        f: Blob,
        o?: unknown,
      ) => Promise<{ error: { message: string } | null }>
      remove: (p: string[]) => Promise<unknown>
    }
  }
  schema: (s: string) => {
    from: (t: string) => {
      insert: (row: Record<string, unknown>) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
      upsert: (
        row: Record<string, unknown>,
        opts: { onConflict: string },
      ) => {
        select: (cols: string) => {
          single: () => Promise<{
            data: { id: string } | null
            error: { message: string } | null
          }>
        }
      }
    }
  }
}

export const SITE_FORM_PHOTO_BUCKET = 'site-form-photos'
export const SITE_FORM_SIGNATURE_BUCKET = 'site-form-signatures'

export async function uploadFormPhoto(
  supabase: UploadClient,
  opts: {
    file: File
    projectId: string
    formId: string
    sectionId: string
    fieldId: string
    sortOrder: number
    uploadedBy: string | null
    caption?: string | null
  },
): Promise<{ id: string } | { error: string }> {
  const prepared = await compressImage(opts.file)
  const ext = (prepared.name.split('.').pop() || 'jpg').toLowerCase()

  // The field id can contain a repeating-group suffix like `circuits[0].photo`,
  // which is not safe in a storage key. Flatten it for the path only; the row
  // keeps the real field id so the PDF can still bind the photo to its field.
  const safeField = opts.fieldId.replace(/[^a-zA-Z0-9_-]/g, '_')
  const path = `${opts.projectId}/${opts.formId}/${opts.sectionId}/${safeField}/${Date.now()}-${opts.sortOrder}.${ext}`

  const { error: upErr } = await supabase.storage
    .from(SITE_FORM_PHOTO_BUCKET)
    .upload(path, prepared, { contentType: prepared.type })
  if (upErr) return { error: upErr.message }

  const { data, error: insErr } = await supabase
    .schema('field')
    .from('form_photos')
    .insert({
      form_id: opts.formId,
      section_id: opts.sectionId,
      field_id: opts.fieldId,
      storage_path: path,
      caption: opts.caption ?? opts.file.name,
      sort_order: opts.sortOrder,
      file_size_bytes: prepared.size,
      taken_at: new Date().toISOString(),
      uploaded_by: opts.uploadedBy,
    })
    .select('id')
    .single()

  if (insErr || !data) {
    await supabase.storage.from(SITE_FORM_PHOTO_BUCKET).remove([path])
    return { error: insErr?.message ?? 'Could not record the photo' }
  }
  return { id: data.id }
}

export async function uploadFormSignature(
  supabase: UploadClient,
  opts: {
    pngBlob: Blob
    projectId: string
    formId: string
    blockId: 'electrician' | 'registered_person' | 'supervisor' | 'client_witness'
    signatoryName: string
    signatoryRole?: string | null
    registrationCategory?: string | null
    registrationNumber?: string | null
    signedBy: string | null
  },
): Promise<{ id: string } | { error: string }> {
  const name = opts.signatoryName.trim()
  if (!name) return { error: 'Enter the name of the person signing.' }

  const path = `${opts.projectId}/${opts.formId}/signatures/${opts.blockId}/${Date.now()}.png`

  const { error: upErr } = await supabase.storage
    .from(SITE_FORM_SIGNATURE_BUCKET)
    .upload(path, opts.pngBlob, { contentType: 'image/png' })
  if (upErr) return { error: upErr.message }

  // One signature per block: re-signing replaces the previous row rather than
  // accumulating, matching the UNIQUE (form_id, block_id) constraint.
  const { data, error: insErr } = await supabase
    .schema('field')
    .from('form_signatures')
    .upsert(
      {
        form_id: opts.formId,
        block_id: opts.blockId,
        signatory_name: name,
        signatory_role: opts.signatoryRole?.trim() || null,
        registration_category: opts.registrationCategory?.trim() || null,
        registration_number: opts.registrationNumber?.trim() || null,
        storage_path: path,
        signed_by: opts.signedBy,
        signed_at: new Date().toISOString(),
      },
      { onConflict: 'form_id,block_id' },
    )
    .select('id')
    .single()

  if (insErr || !data) {
    await supabase.storage.from(SITE_FORM_SIGNATURE_BUCKET).remove([path])
    return { error: insErr?.message ?? 'Could not record the signature' }
  }
  return { id: data.id }
}
