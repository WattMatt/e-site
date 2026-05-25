'use client'

import { useState } from 'react'
import { useFieldPhotos, type FieldPhoto } from './useFieldPhotos'
import { PhotoLightbox, type LightboxPhoto } from '../PhotoLightbox'

interface Props {
  inspectionId: string
  sectionId: string
  fieldId: string
  readOnly: boolean
}

/**
 * Compact photo strip rendered beneath every answerable inspection entry.
 *
 * Photos attach to the entry's own field_id, so each photo is unambiguously
 * tied to the specific check / measurement / field it documents — there is no
 * shared per-section bucket to guess against.
 */
export default function InlinePhotoCapture({ inspectionId, sectionId, fieldId, readOnly }: Props) {
  const { photos, uploading, error, upload, remove } = useFieldPhotos(inspectionId, sectionId, fieldId)
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null)

  const viewable = photos.filter(
    (p): p is FieldPhoto & { signed_url: string } => !!p.signed_url,
  )

  // Read-only with nothing captured: render nothing rather than an empty strip.
  if (readOnly && viewable.length === 0) return null

  return (
    <div
      style={{
        marginTop: 6,
        display: 'flex',
        flexWrap: 'wrap',
        alignItems: 'center',
        gap: 6,
      }}
    >
      {viewable.map((p, i) => (
        <div key={p.id} style={{ position: 'relative' }}>
          <button
            type="button"
            onClick={() => setLightboxIndex(i)}
            aria-label="View photo full size"
            style={{
              padding: 0,
              border: 'none',
              background: 'none',
              cursor: 'zoom-in',
              borderRadius: 4,
              lineHeight: 0,
            }}
          >
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={p.signed_url}
              alt=""
              style={{
                width: 56,
                height: 56,
                objectFit: 'cover',
                borderRadius: 4,
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
                top: -4,
                right: -4,
                width: 18,
                height: 18,
                borderRadius: '50%',
                background: 'var(--c-red, #dc2626)',
                color: '#fff',
                border: '1px solid var(--c-bg, #000)',
                fontSize: 12,
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
      ))}

      {!readOnly && (
        <label
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            padding: '4px 10px',
            borderRadius: 4,
            border: '1px dashed var(--c-border)',
            cursor: uploading ? 'wait' : 'pointer',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            whiteSpace: 'nowrap',
          }}
        >
          {uploading ? 'Uploading…' : viewable.length > 0 ? '+ Photo' : '+ Add photo'}
          <input
            type="file"
            accept="image/*"
            capture="environment"
            disabled={uploading}
            style={{ display: 'none' }}
            onChange={(e) => {
              if (e.target.files?.[0]) upload(e.target.files[0])
              // Reset so re-selecting the same file still fires onChange.
              e.target.value = ''
            }}
          />
        </label>
      )}

      {error && (
        <span style={{ fontSize: 10, color: 'var(--c-red)', width: '100%' }}>{error}</span>
      )}

      {lightboxIndex !== null && (
        <PhotoLightbox
          photos={viewable.map(
            (p): LightboxPhoto => ({
              id: p.id,
              signed_url: p.signed_url,
              taken_at: p.taken_at,
              gps_lat: p.gps_lat,
              gps_lng: p.gps_lng,
            }),
          )}
          activeIndex={Math.min(lightboxIndex, viewable.length - 1)}
          onChange={(i) => setLightboxIndex(i)}
          onClose={() => setLightboxIndex(null)}
          onDelete={!readOnly ? remove : undefined}
        />
      )}
    </div>
  )
}
