'use client'

/**
 * Accessible, touch-capable tooltip for the markup toolbar.
 *
 * Native `title` doesn't fire on touch — a dealbreaker for a site tablet where
 * the palette is icon-only. This wrapper shows a styled bubble on:
 *   - hover (mouse),
 *   - keyboard focus (tab), and
 *   - long-press (touch) — a short tap still activates the control normally.
 *
 * The bubble is portalled to <body> with fixed positioning + edge-clamping, so
 * it never clips against the toolbar's overflow or the viewport edges. It is
 * decorative (pointer-events: none, role="tooltip"); the accessible NAME comes
 * from an aria-label the caller sets on the trigger, so screen readers don't
 * depend on this component at all.
 *
 * No dependencies (no radix/floating-ui) — keep it that way.
 */

import { useCallback, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'

const LONG_PRESS_MS = 350
const TOUCH_HIDE_MS = 1600

export function Tooltip({ label, children }: { label: string; children: ReactNode }) {
  const ref = useRef<HTMLSpanElement | null>(null)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const [pos, setPos] = useState<{ x: number; y: number } | null>(null)

  const show = useCallback(() => {
    const el = ref.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const margin = 90
    const x = Math.min(Math.max(r.left + r.width / 2, margin), window.innerWidth - margin)
    setPos({ x, y: r.bottom + 6 })
  }, [])

  const hide = useCallback(() => setPos(null), [])
  const clearTimer = () => {
    if (timer.current) {
      clearTimeout(timer.current)
      timer.current = null
    }
  }

  if (!label) return <>{children}</>

  return (
    <span
      ref={ref}
      style={{ display: 'inline-flex' }}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      onTouchStart={() => {
        clearTimer()
        timer.current = setTimeout(show, LONG_PRESS_MS)
      }}
      onTouchEnd={() => {
        clearTimer()
        // Reveal briefly after a long-press, then auto-dismiss.
        if (pos) timer.current = setTimeout(hide, TOUCH_HIDE_MS)
      }}
      onTouchCancel={() => {
        clearTimer()
        hide()
      }}
    >
      {children}
      {pos &&
        typeof document !== 'undefined' &&
        createPortal(
          <span
            role="tooltip"
            style={{
              position: 'fixed',
              left: pos.x,
              top: pos.y,
              transform: 'translateX(-50%)',
              zIndex: 1000,
              pointerEvents: 'none',
              maxWidth: 260,
              whiteSpace: 'normal',
              textAlign: 'center',
              background: 'var(--c-base, #0b0f19)',
              color: 'var(--c-text, #e5e7eb)',
              border: '1px solid var(--c-border, #374151)',
              borderRadius: 6,
              padding: '5px 9px',
              fontFamily: 'var(--font-mono, ui-monospace, monospace)',
              fontSize: 10,
              letterSpacing: '0.03em',
              lineHeight: 1.35,
              boxShadow: '0 6px 18px rgba(0,0,0,0.35)',
            }}
          >
            {label}
          </span>,
          document.body,
        )}
    </span>
  )
}
