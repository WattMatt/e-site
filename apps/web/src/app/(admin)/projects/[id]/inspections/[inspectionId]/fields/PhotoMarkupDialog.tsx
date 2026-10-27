'use client'

import dynamic from 'next/dynamic'
import { X } from 'lucide-react'

// The same full MarkupCanvas QC uses on photos and drawings (react-konva), client-only.
const MarkupCanvas = dynamic(
  () => import('@/app/(admin)/projects/[id]/floor-plans/[planId]/MarkupCanvas').then((m) => m.MarkupCanvas),
  {
    ssr: false,
    loading: () => (
      <div
        style={{
          height: '70vh',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'var(--c-text-dim)',
          fontFamily: 'var(--font-mono)',
          fontSize: 12,
        }}
      >
        Loading canvas…
      </div>
    ),
  },
)

interface Props {
  projectId: string
  photo: { id: string; signed_url: string; width_px?: number | null; height_px?: number | null }
  title: string
  /** Receives the flattened markup (the photo with the drawing burnt in). */
  onSave: (png: Blob) => Promise<void>
  onClose: () => void
}

/**
 * Mark up an inspection photo: circle or arrow WHERE the fault is. The result is saved as a new
 * photo on the same item (captioned "Markup"), so the original stays as taken and the report
 * shows both.
 */
export default function PhotoMarkupDialog({ projectId, photo, title, onSave, onClose }: Props) {
  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Mark up photo"
      style={{
        position: 'fixed',
        inset: 0,
        zIndex: 75,
        background: 'rgba(11,11,18,0.88)',
        backdropFilter: 'blur(4px)',
        display: 'flex',
        flexDirection: 'column',
        padding: 16,
        gap: 12,
      }}
    >
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12 }}>
        <div>
          <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>Mark up photo</div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
            {title} · draw where the fault is, then Save
          </div>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            background: 'transparent',
            border: '1px solid var(--c-border)',
            color: 'var(--c-text-mid)',
            borderRadius: 6,
            padding: '5px 9px',
            fontSize: 11,
            cursor: 'pointer',
          }}
        >
          <X size={13} /> Close
        </button>
      </div>
      <div style={{ flex: 1, minHeight: 0, overflow: 'auto' }}>
        <MarkupCanvas
          plan={{
            id: `inspection-photo-${photo.id}`,
            signedUrl: photo.signed_url,
            width_px: photo.width_px ?? null,
            height_px: photo.height_px ?? null,
            pixels_per_meter: null,
            isPdf: false,
          }}
          projectId={projectId}
          snagPins={[]}
          mode="markup"
          onSaveMarkup={async ({ pngBlob }) => {
            await onSave(pngBlob)
            onClose()
          }}
        />
      </div>
    </div>
  )
}
