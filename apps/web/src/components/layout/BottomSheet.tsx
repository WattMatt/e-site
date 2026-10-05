'use client'

import { useEffect, useId, useRef } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

interface BottomSheetProps {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}

/**
 * Phone-shell sheet: anchored to the bottom edge, thumb-reachable, dismissed by
 * the backdrop, the close button or Escape. Opacity-only entrance — a transform
 * animation offsets Safari's hit-testing during the animation (PR #150).
 *
 * Focus moves into the sheet on open and returns to the opener on close; the
 * page behind does not scroll while it is open.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const titleId = useId()
  const sheetRef = useRef<HTMLDivElement>(null)
  const openerRef = useRef<Element | null>(null)

  useEffect(() => {
    if (!open) return
    openerRef.current = document.activeElement
    sheetRef.current?.focus()
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      if (openerRef.current instanceof HTMLElement) openerRef.current.focus()
    }
  }, [open, onClose])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div className="bottom-sheet-root no-print">
      <div className="bottom-sheet-backdrop" aria-hidden="true" onClick={onClose} />
      <div
        ref={sheetRef}
        className="bottom-sheet"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
      >
        <div className="bottom-sheet-grip" aria-hidden="true" />
        <div className="bottom-sheet-header">
          <h2 id={titleId} className="bottom-sheet-title">{title}</h2>
          <button type="button" className="bottom-sheet-close" onClick={onClose} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="bottom-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
