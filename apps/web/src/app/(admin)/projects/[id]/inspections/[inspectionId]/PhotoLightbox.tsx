'use client'

import { useEffect } from 'react'

export interface LightboxPhoto {
  id: string
  signed_url: string
  taken_at?: string | null
  gps_lat?: number | null
  gps_lng?: number | null
}

interface Props {
  photos: LightboxPhoto[]
  activeIndex: number
  onClose: () => void
  onChange: (i: number) => void
  /** When provided, renders a Delete button next to Close. Omitting it hides delete entirely. */
  onDelete?: (id: string) => void
}

export function PhotoLightbox({ photos, activeIndex, onClose, onChange, onDelete }: Props) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowLeft') onChange(Math.max(0, activeIndex - 1))
      if (e.key === 'ArrowRight') onChange(Math.min(photos.length - 1, activeIndex + 1))
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [activeIndex, photos.length, onChange, onClose])

  const photo = photos[activeIndex]
  if (!photo) return null

  return (
    <div
      role="dialog"
      aria-label="Photo viewer"
      className="fixed inset-0 z-50 flex items-center justify-center"
      style={{ background: 'rgba(0,0,0,0.9)' }}
      onClick={onClose}
    >
      {/* Previous */}
      <button
        onClick={(e) => { e.stopPropagation(); onChange(activeIndex - 1) }}
        disabled={activeIndex === 0}
        aria-label="Previous photo"
        style={{
          position: 'absolute',
          left: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#fff',
          fontSize: 40,
          lineHeight: 1,
          padding: '8px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          opacity: activeIndex === 0 ? 0.3 : 1,
        }}
      >
        ‹
      </button>

      {/* Next */}
      <button
        onClick={(e) => { e.stopPropagation(); onChange(activeIndex + 1) }}
        disabled={activeIndex === photos.length - 1}
        aria-label="Next photo"
        style={{
          position: 'absolute',
          right: 16,
          top: '50%',
          transform: 'translateY(-50%)',
          color: '#fff',
          fontSize: 40,
          lineHeight: 1,
          padding: '8px 16px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
          opacity: activeIndex === photos.length - 1 ? 0.3 : 1,
        }}
      >
        ›
      </button>

      {/* Delete — only rendered when the parent passes an onDelete handler */}
      {onDelete && (
        <button
          onClick={(e) => {
            e.stopPropagation()
            if (confirm('Delete this photo?')) {
              onDelete(photo.id)
              onClose()
            }
          }}
          aria-label="Delete photo"
          style={{
            position: 'absolute',
            top: 16,
            right: 64,
            color: '#ff6b6b',
            fontSize: 13,
            fontWeight: 600,
            lineHeight: 1,
            padding: '8px 14px',
            background: 'rgba(0,0,0,0.45)',
            border: '1px solid rgba(255,107,107,0.5)',
            borderRadius: 6,
            cursor: 'pointer',
          }}
        >
          Delete
        </button>
      )}

      {/* Close */}
      <button
        onClick={onClose}
        aria-label="Close photo viewer"
        style={{
          position: 'absolute',
          top: 16,
          right: 16,
          color: '#fff',
          fontSize: 28,
          lineHeight: 1,
          padding: '4px 10px',
          background: 'none',
          border: 'none',
          cursor: 'pointer',
        }}
      >
        ×
      </button>

      {/* Image — stopPropagation so clicking the image itself does NOT close */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={photo.signed_url}
        alt=""
        style={{ maxHeight: '90vh', maxWidth: '90vw', objectFit: 'contain' }}
        onClick={(e) => e.stopPropagation()}
      />

      {/* Caption bar */}
      <div
        style={{
          position: 'absolute',
          bottom: 16,
          left: '50%',
          transform: 'translateX(-50%)',
          color: '#fff',
          fontSize: 13,
          background: 'rgba(0,0,0,0.5)',
          padding: '4px 12px',
          borderRadius: 6,
          whiteSpace: 'nowrap',
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {activeIndex + 1} / {photos.length}
        {photo.taken_at
          ? ` · ${new Date(photo.taken_at).toLocaleString('en-ZA')}`
          : ''}
        {photo.gps_lat != null && photo.gps_lng != null
          ? ` · 📍 ${photo.gps_lat.toFixed(4)}, ${photo.gps_lng.toFixed(4)}`
          : ''}
      </div>
    </div>
  )
}
