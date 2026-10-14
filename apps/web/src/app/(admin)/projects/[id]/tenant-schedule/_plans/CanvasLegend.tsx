'use client'

/**
 * The colour key that sits over the drawing (owner, 2026-10-14: "clearly colour
 * coded with some sort of legend"). Always visible while the plan is open, top
 * left over the canvas, collapsible to one button so it never hides the part of
 * the drawing being worked on. Each row: the solid swatch drawn on the sheet,
 * what it means, and how many shapes on THIS sheet carry it. The side-panel
 * PlanLegend keeps the fuller picture (all sheets, area, needs attention).
 *
 * Fixed light colours on purpose: it sits on the drawing, which is white paper
 * in every theme.
 */
import { useState } from 'react'
import type { LegendEntry, ShapeStyle } from '@esite/shared/status-plans'
import { swatchCss } from '@/lib/status-plans/shape-view'

export interface CanvasLegendEntry {
  key: string
  label: string
  style: ShapeStyle
  count: number
}

/** Status mode: the palette's legend with this sheet's counts. */
export function canvasLegendEntries(legend: readonly LegendEntry[], counts: Readonly<Record<string, number>>): CanvasLegendEntry[] {
  return legend.map((e) => ({ key: e.key, label: e.label, style: e.style, count: counts[e.key] ?? 0 }))
}

export function CanvasLegend({ entries }: { entries: readonly CanvasLegendEntry[] }) {
  const [open, setOpen] = useState(true)
  return (
    <div
      data-canvas-legend
      style={{
        position: 'absolute', top: 8, left: 8, zIndex: 2,
        maxWidth: 'min(280px, calc(100% - 16px))', maxHeight: 'calc(100% - 16px)',
        display: 'flex', flexDirection: 'column',
        background: 'rgba(255, 255, 255, 0.94)', color: '#1F2328',
        border: '1px solid rgba(31, 35, 40, 0.2)', borderRadius: 6,
        boxShadow: '0 1px 4px rgba(0, 0, 0, 0.15)', fontSize: 12, lineHeight: 1.3,
      }}
    >
      <button
        type="button"
        aria-expanded={open}
        aria-label={open ? 'Hide colour key' : 'Show colour key'}
        onClick={() => setOpen((o) => !o)}
        style={{
          display: 'flex', alignItems: 'center', gap: 6, minHeight: 32, padding: '4px 10px',
          background: 'none', border: 0, color: 'inherit', font: 'inherit', fontWeight: 600, cursor: 'pointer', textAlign: 'left',
        }}
      >
        <span aria-hidden>{open ? '▾' : '▸'}</span> Key
      </button>
      {open && (
        <ul
          aria-label="Colour key"
          style={{ listStyle: 'none', margin: 0, padding: '0 10px 8px', display: 'grid', gap: 4, overflowY: 'auto', touchAction: 'pan-y' }}
        >
          {entries.map((e) => (
            <li key={e.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
              <span data-swatch aria-hidden style={{ flex: 'none', width: 18, height: 12, borderRadius: 2, display: 'inline-block', ...swatchCss(e.style) }} />
              <span style={{ flex: 1, minWidth: 0 }}>{e.label}</span>
              <span style={{ fontFamily: 'var(--font-mono)', minWidth: 20, textAlign: 'right', fontWeight: 600 }}>{e.count}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
