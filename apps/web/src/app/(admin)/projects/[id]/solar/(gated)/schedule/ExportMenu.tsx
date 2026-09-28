'use client'
/**
 * Export menu. Offers only what exists (owner decision Q7: no Word export):
 * PNG from the canvas in the browser, and the three server formats from
 * GET /api/projects/[id]/solar/schedule/export/{pdf|xlsx|ics}.
 */
import { useState } from 'react'
import { POPOVER } from './popover-style'

export const SCHEDULE_EXPORT_FORMATS = [
  ['pdf', 'PDF (A3 landscape)'],
  ['xlsx', 'Excel'],
  ['ics', 'Calendar (.ics)'],
] as const

export interface ExportMenuProps {
  /** e.g. `/api/projects/<id>/solar/schedule/export` — a string, never a function (page → client props are JSON). */
  exportBase: string
  onExportPng: () => void
}

export function ExportMenu({ exportBase, onExportPng }: ExportMenuProps) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} aria-haspopup="menu" onClick={() => setOpen((o) => !o)}>Export ▾</button>
      {open && (
        <div role="menu" style={{ ...POPOVER, right: 0, width: 200, padding: 8, display: 'grid', gap: 4 }}>
          <button type="button" onClick={() => { setOpen(false); onExportPng() }}>Image (PNG)</button>
          {SCHEDULE_EXPORT_FORMATS.map(([f, label]) => (
            <a key={f} href={`${exportBase}/${f}`} download onClick={() => setOpen(false)}>{label}</a>
          ))}
        </div>
      )}
    </div>
  )
}
