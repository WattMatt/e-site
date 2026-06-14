'use client'

import { useRef, useEffect } from 'react'

interface Props {
  children: React.ReactNode
  className?: string
  /** Merged over the wrapper's overflow styles (e.g. negative margins to bleed into panel padding). */
  style?: React.CSSProperties
}

/**
 * Horizontal-scroll wrapper for wide tables that keeps vertical page-scroll
 * alive while the pointer is over the table.
 *
 * When the table overflows horizontally, browsers latch wheel gestures onto
 * the scroll wrapper and DISCARD the vertical delta (the wrapper has no
 * vertical range), so the page won't scroll while the pointer is over the
 * table — verified in Chromium with overflow-y: hidden too. Take over
 * vertical-dominant wheel events and hand them to the page ourselves.
 * Native listener because React's onWheel is passive (can't preventDefault).
 */
export function TableScrollX({ children, className, style }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    function onWheel(e: WheelEvent) {
      if (e.ctrlKey) return // pinch-zoom gesture — leave to the browser
      if (Math.abs(e.deltaY) <= Math.abs(e.deltaX)) return // horizontal — native
      e.preventDefault()
      const unit = e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? window.innerHeight : 1
      window.scrollBy({ top: e.deltaY * unit })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  return (
    // overflowY explicit (overflow-x alone computes overflow-y to auto); the
    // wheel handler does the real work of keeping vertical page-scroll alive.
    <div ref={ref} className={className} style={{ overflowX: 'auto', overflowY: 'hidden', ...style }}>
      {children}
    </div>
  )
}
