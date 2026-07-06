'use client'

import { useCallback, useEffect, useState } from 'react'
import { useParams } from 'next/navigation'
import { createClient } from '@/lib/supabase/client'

export interface FieldPhoto {
  id: string
  storage_path: string
  signed_url?: string
  taken_at?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
}

/**
 * Downscale + re-encode a captured photo before upload.
 *
 * Uploads go straight from the browser to Supabase Storage (no Vercel
 * function in the byte path), but a raw tablet/phone camera photo (2-6 MB)
 * is still wasteful to store and slow to sync in the field. This mirrors
 * the mobile app's pre-upload step: resize to 2048 px wide and re-encode as
 * JPEG q0.85. `imageOrientation: 'from-image'` bakes EXIF rotation into the
 * pixels, so the result needs no orientation tag.
 *
 * Any failure (undecodable format, no canvas) falls back to the original file
 * so a capture is never silently dropped — the bucket's 10 MB cap is the
 * only hard limit on that path.
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

/** Map raw storage/PostgREST failures to messages a field worker can act on. */
function friendlyUploadError(raw: string): string {
  const msg = raw.toLowerCase()
  if (msg.includes('row-level security') || msg.includes('violates')) {
    return 'Upload not allowed — this inspection is no longer editable (certified, abandoned or awaiting verification).'
  }
  if (msg.includes('maximum allowed size') || msg.includes('too large') || msg.includes('exceeded')) {
    return 'Photo exceeds the 10 MB storage limit.'
  }
  return raw
}

/**
 * Loads and uploads the photos attached to one inspection field.
 *
 * Photos are keyed by (inspection_id, section_id, field_id) — so the
 * field_id passed here is the only thing that scopes a photo to its entry.
 * Passing a real entry's field_id (a pass_fail check, a measurement, …)
 * ties the photo to that exact entry.
 *
 * Uploads and deletes run entirely under the USER's session:
 *  - bytes go browser → Storage (bucket RLS: user_can_write_responses,
 *    migration 00073) — never through a Vercel function, so the 4.5 MB
 *    request-body cap does not apply;
 *  - the photos row insert/delete is gated by the photos_insert /
 *    photos_delete policies (00066), so uploader-or-PM delete semantics are
 *    enforced by the database, not by route code.
 */
export function useFieldPhotos(inspectionId: string, sectionId: string, fieldId: string) {
  const supabase = createClient()
  // Capture routes live under /projects/[id]/… — the param is the project id.
  const params = useParams<{ id?: string }>()
  const [photos, setPhotos] = useState<FieldPhoto[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let cancelled = false
    ;(async () => {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const { data } = await (supabase as any)
        .schema('inspections')
        .from('photos')
        .select('id, storage_path, taken_at, gps_lat, gps_lng')
        .eq('inspection_id', inspectionId)
        .eq('section_id', sectionId)
        .eq('field_id', fieldId)
      if (cancelled) return
      const rows = (data ?? []) as FieldPhoto[]
      const withUrls = await Promise.all(
        rows.map(async (p) => {
          const { data: sig } = await supabase.storage
            .from('inspection-photos')
            .createSignedUrl(p.storage_path, 3600)
          return { ...p, signed_url: sig?.signedUrl ?? undefined }
        }),
      )
      if (!cancelled) setPhotos(withUrls)
    })()
    return () => {
      cancelled = true
    }
  }, [supabase, inspectionId, sectionId, fieldId])

  const upload = useCallback(
    async (file: File) => {
      setUploading(true)
      setError(null)
      try {
        const prepared = await compressImage(file)

        // Storage RLS keys off path segment [2] (the inspection id); the
        // leading project segment keeps paths consistent with historic
        // uploads. Fall back to a lookup when rendered off-route.
        let projectId = typeof params?.id === 'string' ? params.id : null
        if (!projectId) {
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: insp } = await (supabase as any)
            .schema('inspections')
            .from('inspections')
            .select('project_id')
            .eq('id', inspectionId)
            .maybeSingle()
          projectId = (insp?.project_id as string | undefined) ?? null
        }
        if (!projectId) throw new Error('Could not resolve the inspection project')

        const {
          data: { user },
        } = await supabase.auth.getUser()
        if (!user) throw new Error('Not signed in')

        const safeName = prepared.name.replace(/[^a-zA-Z0-9._-]/g, '_')
        const path = `${projectId}/${inspectionId}/${sectionId}/${fieldId}/${Date.now()}-${safeName}`
        const { error: upErr } = await supabase.storage
          .from('inspection-photos')
          .upload(path, prepared, { contentType: prepared.type })
        if (upErr) throw new Error(friendlyUploadError(upErr.message))

        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { data: row, error: insErr } = await (supabase as any)
          .schema('inspections')
          .from('photos')
          .insert({
            inspection_id: inspectionId,
            section_id: sectionId,
            field_id: fieldId,
            storage_path: path,
            file_size_bytes: prepared.size,
            uploaded_by: user.id,
          })
          .select('id')
          .single()
        if (insErr || !row) {
          // Roll the object back so storage never holds an unreferenced file.
          await supabase.storage.from('inspection-photos').remove([path]).catch(() => undefined)
          throw new Error(friendlyUploadError(insErr?.message ?? 'Saving the photo record failed'))
        }

        const { data: sig } = await supabase.storage
          .from('inspection-photos')
          .createSignedUrl(path, 3600)
        setPhotos((prev) => [
          ...prev,
          { id: (row as { id: string }).id, storage_path: path, signed_url: sig?.signedUrl ?? undefined },
        ])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setUploading(false)
      }
    },
    [supabase, inspectionId, sectionId, fieldId, params],
  )

  const remove = useCallback(
    async (id: string) => {
      setError(null)
      const prev = photos
      const target = prev.find((x) => x.id === id)
      // Optimistic: drop from local state immediately; roll back on failure.
      setPhotos((p) => p.filter((x) => x.id !== id))
      try {
        // photos_delete RLS: uploader-or-PM, and only while the inspection is
        // in a writable status. count=0 means the policy filtered the row.
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        const { error: delErr, count } = await (supabase as any)
          .schema('inspections')
          .from('photos')
          .delete({ count: 'exact' })
          .eq('id', id)
        if (delErr) throw new Error(delErr.message)
        if (!count) {
          // 0 rows deleted: either RLS filtered it (no permission) or the row
          // was already deleted elsewhere (second device, double-tap). Only
          // the former is an error — re-check existence to tell them apart.
          // eslint-disable-next-line @typescript-eslint/no-explicit-any
          const { data: still } = await (supabase as any)
            .schema('inspections')
            .from('photos')
            .select('id')
            .eq('id', id)
            .maybeSingle()
          if (still) {
            throw new Error(
              'Delete not permitted — only the uploader or a project manager can remove a photo, and only while the inspection is editable.',
            )
          }
          return // already gone server-side; keep the optimistic removal
        }
        // Row is gone; the file delete is best-effort (an orphaned object is
        // invisible — no photos row points at it).
        if (target) {
          await supabase.storage
            .from('inspection-photos')
            .remove([target.storage_path])
            .catch(() => undefined)
        }
      } catch (e) {
        setPhotos(prev)
        setError((e as Error).message)
      }
    },
    [photos, supabase],
  )

  return { photos, uploading, error, upload, remove }
}
