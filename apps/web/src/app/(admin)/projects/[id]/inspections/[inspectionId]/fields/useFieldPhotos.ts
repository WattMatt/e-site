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
        const fd = new FormData()
        fd.append('file', file)
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

  return { photos, uploading, error, upload }
}
