'use client'

import { useCallback, useEffect, useState } from 'react'
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
 * The upload route runs as a Vercel serverless function whose request body
 * is capped at ~4.5 MB — a raw tablet/phone camera photo (2-6 MB) can exceed
 * that and fail. This mirrors the mobile app's pre-upload step: resize to
 * 2048 px wide and re-encode as JPEG q0.85. `imageOrientation: 'from-image'`
 * bakes EXIF rotation into the pixels, so the result needs no orientation tag.
 *
 * Any failure (undecodable format, no canvas) falls back to the original file
 * so a capture is never silently dropped.
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
 * Loads and uploads the photos attached to one inspection field.
 *
 * Photos are keyed by (inspection_id, section_id, field_id) — the same tuple
 * the upload route writes — so the field_id passed here is the only thing
 * that scopes a photo to its entry. Passing a real entry's field_id (a
 * pass_fail check, a measurement, …) ties the photo to that exact entry.
 */
export function useFieldPhotos(inspectionId: string, sectionId: string, fieldId: string) {
  const supabase = createClient()
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
        const fd = new FormData()
        fd.append('file', prepared)
        fd.append('inspectionId', inspectionId)
        fd.append('sectionId', sectionId)
        fd.append('fieldId', fieldId)
        const res = await fetch('/api/inspections/upload-photo', { method: 'POST', body: fd })
        if (!res.ok) {
          const t = await res.text()
          throw new Error(`Upload failed (HTTP ${res.status}): ${t}`)
        }
        const { id, storage_path } = (await res.json()) as { id: string; storage_path: string }
        const { data: sig } = await supabase.storage
          .from('inspection-photos')
          .createSignedUrl(storage_path, 3600)
        setPhotos((prev) => [...prev, { id, storage_path, signed_url: sig?.signedUrl ?? undefined }])
      } catch (e) {
        setError((e as Error).message)
      } finally {
        setUploading(false)
      }
    },
    [supabase, inspectionId, sectionId, fieldId],
  )

  const remove = useCallback(
    async (id: string) => {
      setError(null)
      const prev = photos
      // Optimistic: drop from local state immediately; roll back on API failure.
      setPhotos((p) => p.filter((x) => x.id !== id))
      try {
        const res = await fetch('/api/inspections/delete-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ photoId: id }),
        })
        if (!res.ok) {
          const t = await res.text()
          throw new Error(`Delete failed (HTTP ${res.status}): ${t}`)
        }
      } catch (e) {
        setPhotos(prev)
        setError((e as Error).message)
      }
    },
    [photos],
  )

  return { photos, uploading, error, upload, remove }
}
