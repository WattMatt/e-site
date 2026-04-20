'use client'

import { useState, useEffect } from 'react'

interface Photo { id: string; url?: string; caption?: string; photo_type: string }

export function SnagPhotoGrid({ photos }: { photos: Photo[] }) {
  const [lightbox, setLightbox] = useState<Photo | null>(null)

  useEffect(() => {
    if (!lightbox) return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') setLightbox(null) }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [lightbox])

  return (
    <>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 8 }}>
        {photos.map((p) => (
          <button
            key={p.id}
            type="button"
            onClick={() => setLightbox(p)}
            aria-label={p.caption ?? 'Open photo'}
            style={{
              aspectRatio: '1 / 1', width: '100%', padding: 0, overflow: 'hidden',
              borderRadius: 6, border: '1px solid var(--c-border)',
              background: 'var(--c-panel)', cursor: 'pointer',
              transition: 'border-color 0.15s',
            }}
          >
            {p.url ? (
              <img src={p.url} alt={p.caption ?? ''} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
            ) : (
              <div style={{
                width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center',
                fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.06em',
              }}>
                Loading…
              </div>
            )}
          </button>
        ))}
      </div>

      {lightbox && (
        <div
          role="dialog"
          aria-modal="true"
          aria-label={lightbox.caption ?? 'Photo'}
          onClick={() => setLightbox(null)}
          style={{
            position: 'fixed', inset: 0, zIndex: 60,
            background: 'rgba(0,0,0,0.92)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            padding: 24,
          }}
        >
          <div onClick={e => e.stopPropagation()} style={{ maxWidth: '90vw', maxHeight: '90vh', position: 'relative' }}>
            {lightbox.url && (
              <img
                src={lightbox.url}
                alt={lightbox.caption ?? ''}
                style={{ maxWidth: '100%', maxHeight: '80vh', borderRadius: 8, display: 'block' }}
              />
            )}
            {lightbox.caption && (
              <p style={{
                textAlign: 'center', marginTop: 10,
                fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-mid)', letterSpacing: '0.04em',
              }}>
                {lightbox.caption}
              </p>
            )}
            <button
              type="button"
              onClick={() => setLightbox(null)}
              aria-label="Close"
              style={{
                position: 'absolute', top: -8, right: -8,
                width: 32, height: 32, borderRadius: '50%',
                background: 'var(--c-panel)', border: '1px solid var(--c-border)',
                color: 'var(--c-text)', fontSize: 16, cursor: 'pointer',
                display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
              }}
            >×</button>
          </div>
        </div>
      )}
    </>
  )
}
