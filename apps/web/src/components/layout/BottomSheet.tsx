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
 * Modal for real: everything else in <body> is made `inert` while it is open,
 * so Tab and screen readers cannot reach the page behind it. Focus moves into
 * the sheet on open and goes back to the opener only when the user DISMISSES
 * the sheet — when a link inside it navigates, focus stays with the new page.
 */
export function BottomSheet({ open, onClose, title, children }: BottomSheetProps) {
  const titleId = useId()
  const rootRef = useRef<HTMLDivElement>(null)
  const sheetRef = useRef<HTMLDivElement>(null)
  const onCloseRef = useRef(onClose)
  const restoreFocusRef = useRef(false)
  onCloseRef.current = onClose

  function dismiss() {
    restoreFocusRef.current = true
    onCloseRef.current()
  }

  useEffect(() => {
    if (!open) return
    const opener = document.activeElement
    restoreFocusRef.current = false
    sheetRef.current?.focus()

    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'

    const madeInert: Element[] = []
    for (const el of Array.from(document.body.children)) {
      if (el === rootRef.current || el.hasAttribute('inert')) continue
      el.setAttribute('inert', '')
      madeInert.push(el)
    }

    function onKey(e: KeyboardEvent) {
      if (e.key !== 'Escape') return
      restoreFocusRef.current = true
      onCloseRef.current()
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      for (const el of madeInert) el.removeAttribute('inert')
      if (restoreFocusRef.current && opener instanceof HTMLElement && opener.isConnected) opener.focus()
    }
  }, [open])

  if (!open || typeof document === 'undefined') return null

  return createPortal(
    <div ref={rootRef} className="bottom-sheet-root no-print">
      <div className="bottom-sheet-backdrop" aria-hidden="true" onClick={dismiss} />
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
          <button type="button" className="bottom-sheet-close" onClick={dismiss} aria-label="Close">
            <X size={20} aria-hidden="true" />
          </button>
        </div>
        <div className="bottom-sheet-body">{children}</div>
      </div>
    </div>,
    document.body,
  )
}
