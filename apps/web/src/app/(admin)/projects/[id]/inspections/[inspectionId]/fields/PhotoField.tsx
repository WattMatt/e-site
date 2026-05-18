'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { PhotoLightbox, type LightboxPhoto } from '../PhotoLightbox'

interface PhotoItem {
  id: string
  storage_path: string
  signed_url?: string
  taken_at?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
}

export default function PhotoField({ field, inspectionId, sectionId, readOnly }: RendererProps) {
  const supabase = createClient()
  const [photos, setPhotos] = useState<PhotoItem[]>([])
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null)

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
        .eq('field_id', field.field_id)
      if (cancelled) return
      const rows = (data ?? []) as PhotoItem[]
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
  }, [supabase, inspectionId, sectionId, field.field_id])

  const onUpload = async (file: File) => {
    setUploading(true)
    setError(null)
    try {
      const fd = new FormData()
      fd.append('file', file)
      fd.append('inspectionId', inspectionId)
      fd.append('sectionId', sectionId)
      fd.append('fieldId', field.field_id)
      const res = await fetch('/api/inspections/upload-photo', { method: 'POST', body: fd })
      if (!res.ok) {
        const t = await res.text()
        throw new Error(`Upload failed (HTTP ${res.status}): ${t}`)
      }
      const { id, storage_path } = (await res.json()) as { id: string; storage_path: string }
      const { data: sig } = await supabase.storage
        .from('inspection-photos')
        .createSignedUrl(storage_path, 3600)
      setPhotos((prev) => [...prev, { id, storage_path, signed_url: sig?.signedUrl }])
    } catch (e) {
      setError((e as Error).message)
    } finally {
      setUploading(false)
    }
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <label style={{ fontSize: 13, fontWeight: 500, color: 'var(--c-text)' }}>
        {field.label}
        {field.required && <span style={{ color: 'var(--c-red)', marginLeft: 4 }}>*</span>}
      </label>
      {field.help_text && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: 0 }}>{field.help_text}</p>
      )}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {photos.map(
          (p, i) =>
            p.signed_url && (
              <button
                key={p.id}
                type="button"
                onClick={() => setLightbox({ index: i })}
                style={{
                  padding: 0,
                  border: 'none',
                  background: 'none',
                  cursor: 'zoom-in',
                  borderRadius: 6,
                  overflow: 'hidden',
                }}
                aria-label="View photo full size"
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={p.signed_url}
                  alt=""
                  style={{
                    width: '100%',
                    height: 96,
                    objectFit: 'cover',
                    borderRadius: 6,
                    border: '1px solid var(--c-border)',
                    display: 'block',
                  }}
                />
              </button>
            ),
        )}
        {!readOnly && (
          <label
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              width: '100%',
              height: 96,
              border: '2px dashed var(--c-border)',
              borderRadius: 6,
              cursor: 'pointer',
              fontSize: 11,
              color: 'var(--c-text-dim)',
            }}
          >
            {uploading ? 'Uploading…' : '+ Add photo'}
            <input
              type="file"
              accept="image/*"
              capture="environment"
              style={{ display: 'none' }}
              onChange={(e) => e.target.files?.[0] && onUpload(e.target.files[0])}
            />
          </label>
        )}
      </div>
      {error && (
        <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>
      )}
      {lightbox !== null && (() => {
        const lightboxPhotos: LightboxPhoto[] = photos
          .filter((p): p is PhotoItem & { signed_url: string } => !!p.signed_url)
          .map((p) => ({
            id: p.id,
            signed_url: p.signed_url,
            taken_at: p.taken_at,
            gps_lat: p.gps_lat,
            gps_lng: p.gps_lng,
          }))
        // Map lightbox.index (into photos[]) to the index in lightboxPhotos (signed_url-only subset)
        const signedIndex = lightboxPhotos.findIndex(
          (lp) => lp.id === photos[lightbox.index]?.id,
        )
        const safeIndex = signedIndex >= 0 ? signedIndex : 0
        return (
          <PhotoLightbox
            photos={lightboxPhotos}
            activeIndex={safeIndex}
            onChange={(i) => {
              const targetId = lightboxPhotos[i]?.id
              const originalIndex = photos.findIndex((p) => p.id === targetId)
              setLightbox({ index: originalIndex >= 0 ? originalIndex : i })
            }}
            onClose={() => setLightbox(null)}
          />
        )
      })()}
    </div>
  )
}
