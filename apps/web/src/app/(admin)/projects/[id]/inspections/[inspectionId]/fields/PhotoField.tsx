'use client'

import type { RendererProps } from '../FieldRenderer'
import { useState } from 'react'
import { useFieldPhotos } from './useFieldPhotos'
import { PhotoLightbox, type LightboxPhoto } from '../PhotoLightbox'

export default function PhotoField({ field, inspectionId, sectionId, readOnly }: RendererProps) {
  const { photos, uploading, error, upload, remove } = useFieldPhotos(
    inspectionId,
    sectionId,
    field.field_id,
  )
  const [lightbox, setLightbox] = useState<{ index: number } | null>(null)

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
              <div key={p.id} style={{ position: 'relative' }}>
                <button
                  type="button"
                  onClick={() => setLightbox({ index: i })}
                  style={{
                    padding: 0,
                    border: 'none',
                    background: 'none',
                    cursor: 'zoom-in',
                    borderRadius: 6,
                    overflow: 'hidden',
                    width: '100%',
                    display: 'block',
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
                {!readOnly && (
                  <button
                    type="button"
                    onClick={(e) => {
                      e.stopPropagation()
                      if (confirm('Delete this photo?')) remove(p.id)
                    }}
                    aria-label="Delete photo"
                    title="Delete photo"
                    style={{
                      position: 'absolute',
                      top: 4,
                      right: 4,
                      width: 22,
                      height: 22,
                      borderRadius: '50%',
                      background: 'rgba(220, 38, 38, 0.92)',
                      color: '#fff',
                      border: '1px solid rgba(255,255,255,0.9)',
                      fontSize: 14,
                      lineHeight: 1,
                      padding: 0,
                      cursor: 'pointer',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    ×
                  </button>
                )}
              </div>
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
              onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])}
            />
          </label>
        )}
      </div>
      {error && <p style={{ fontSize: 11, color: 'var(--c-red)', margin: 0 }}>{error}</p>}
      {lightbox !== null &&
        (() => {
          const lightboxPhotos: LightboxPhoto[] = photos
            .filter((p): p is typeof p & { signed_url: string } => !!p.signed_url)
            .map((p) => ({
              id: p.id,
              signed_url: p.signed_url,
              taken_at: p.taken_at,
              gps_lat: p.gps_lat,
              gps_lng: p.gps_lng,
            }))
          // Map lightbox.index (into photos[]) to the index in lightboxPhotos
          // (the signed_url-only subset).
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
              onDelete={!readOnly ? remove : undefined}
            />
          )
        })()}
    </div>
  )
}
