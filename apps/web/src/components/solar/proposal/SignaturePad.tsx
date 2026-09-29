'use client'
/** Optional drawn signature (spec §9.4). Emits a PNG data URL (≤ 400 KB, 00217 CHECK) or null. */
import { useRef } from 'react'

export function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const drawing = useRef(false)
  const ctx = () => ref.current?.getContext('2d') ?? null
  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    return { x: e.clientX - r.left, y: e.clientY - r.top }
  }
  return (
    <div style={{ display: 'grid', gap: 4 }}>
      <canvas
        ref={ref} width={400} height={120} aria-label="Signature (optional)" role="img"
        style={{ border: '1px solid var(--c-border)', borderRadius: 4, touchAction: 'none', background: '#fff', maxWidth: '100%' }}
        onPointerDown={(e) => { const c = ctx(); if (!c) return; drawing.current = true; const p = pos(e); c.beginPath(); c.moveTo(p.x, p.y) }}
        onPointerMove={(e) => { if (!drawing.current) return; const c = ctx(); if (!c) return; const p = pos(e); c.lineWidth = 2; c.lineCap = 'round'; c.strokeStyle = '#111'; c.lineTo(p.x, p.y); c.stroke() }}
        onPointerUp={() => {
          if (!drawing.current) return
          drawing.current = false
          const url = ref.current?.toDataURL('image/png') ?? null
          onChange(url && url.length <= 400_000 ? url : null)
        }}
      />
      <button type="button" style={{ justifySelf: 'start', fontSize: 12 }} onClick={() => { const c = ctx(); if (c && ref.current) c.clearRect(0, 0, ref.current.width, ref.current.height); onChange(null) }}>Clear signature</button>
    </div>
  )
}
