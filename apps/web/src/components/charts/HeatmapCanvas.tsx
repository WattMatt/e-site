'use client'
import { useEffect, useRef, useState } from 'react'
import { HEAT_NULL, heatColour } from './palette'
import { formatNumber } from './scale'

/** Rows (dates or months) × 24 hours on a canvas. Null cells are grey ("No data"). */
export function HeatmapCanvas({ title, rows, cells, unit, cellH }: { title: string; rows: string[]; cells: Array<Array<number | null>>; unit: string; cellH?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null)
  const [hover, setHover] = useState<string | null>(null)
  const values = cells.flat().filter((v): v is number => v !== null)
  const lo = values.length ? Math.min(...values) : 0
  const hi = values.length ? Math.max(...values) : 1
  const ch = cellH ?? (rows.length > 60 ? 2 : 16)
  const cw = 24
  useEffect(() => {
    const ctx = ref.current?.getContext('2d')
    if (!ctx) return
    cells.forEach((row, r) => row.forEach((v, c) => {
      ctx.fillStyle = v === null ? HEAT_NULL : heatColour(hi > lo ? (v - lo) / (hi - lo) : 0.5)
      ctx.fillRect(c * cw, r * ch, cw, ch)
    }))
  }, [cells, lo, hi, ch])
  return (
    <div>
      <canvas ref={ref} role="img" aria-label={title} width={24 * cw} height={Math.max(1, rows.length) * ch}
        style={{ width: '100%', maxWidth: 24 * cw, imageRendering: 'pixelated', display: 'block' }}
        onMouseMove={(e) => {
          const b = e.currentTarget.getBoundingClientRect()
          if (b.width === 0) return
          const c = Math.floor(((e.clientX - b.left) / b.width) * 24)
          const r = Math.floor(((e.clientY - b.top) / b.height) * rows.length)
          const v = cells[r]?.[c]
          setHover(rows[r] === undefined ? null : `${rows[r]} ${String(c).padStart(2, '0')}:00 · ${v === null || v === undefined ? 'no data' : `${formatNumber(v, 2)} ${unit}`}`)
        }}
        onMouseLeave={() => setHover(null)} />
      <div style={{ display: 'flex', gap: 12, alignItems: 'center', fontSize: 12, marginTop: 4, color: 'var(--c-text-mid)' }}>
        <span>{`${formatNumber(lo, Number.isInteger(lo) ? 0 : 1)} ${unit}`}</span>
        <span style={{ width: 120, height: 8, background: `linear-gradient(90deg, ${heatColour(0)}, ${heatColour(1)})` }} />
        <span>{`${formatNumber(hi, Number.isInteger(hi) ? 0 : 1)} ${unit}`}</span>
        <span><span style={{ width: 10, height: 10, background: HEAT_NULL, display: 'inline-block', marginRight: 4 }} />No data</span>
        {hover && <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)' }}>{hover}</span>}
      </div>
    </div>
  )
}
