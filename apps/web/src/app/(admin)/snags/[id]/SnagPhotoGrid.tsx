'use client'

import { useState } from 'react'

interface Photo { id: string; url?: string; caption?: string; photo_type: string }

export function SnagPhotoGrid({ photos }: { photos: Photo[] }) {
  const [lightbox, setLightbox] = useState<Photo | null>(null)

  return (
    <>
      <div className="grid grid-cols-3 gap-2">
        {photos.map((p) => (
          <button key={p.id} onClick={() => setLightbox(p)} className="aspect-square rounded-lg overflow-hidden border border-slate-700 hover:border-blue-500 transition-colors">
            {p.url ? (
              <img src={p.url} alt={p.caption ?? ''} className="w-full h-full object-cover" />
            ) : (
              <div className="w-full h-full bg-slate-700 flex items-center justify-center text-slate-500 text-xs">Loading…</div>
            )}
          </button>
        ))}
      </div>

      {/* Lightbox */}
      {lightbox && (
        <div className="fixed inset-0 bg-black/90 z-50 flex items-center justify-center p-4" onClick={() => setLightbox(null)}>
          <div className="max-w-4xl max-h-full" onClick={e => e.stopPropagation()}>
            {lightbox.url && <img src={lightbox.url} alt={lightbox.caption ?? ''} className="max-h-[80vh] max-w-full rounded-lg" />}
            {lightbox.caption && <p className="text-slate-300 text-sm text-center mt-2">{lightbox.caption}</p>}
            <button onClick={() => setLightbox(null)} className="absolute top-4 right-4 text-white text-2xl">×</button>
          </div>
        </div>
      )}
    </>
  )
}
