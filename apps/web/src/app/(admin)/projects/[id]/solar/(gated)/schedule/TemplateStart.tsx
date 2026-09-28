'use client'
/**
 * Empty state (spec §14.1): "Use template" is the primary action, dated from a
 * chosen start. Below Edit it says who can add a programme instead.
 */
import { useState } from 'react'
import { isCalendarDate, type CalendarDate } from '@esite/shared'

export interface TemplateStartProps {
  canEdit: boolean
  defaultStart: CalendarDate
  onUseTemplate: (start: CalendarDate) => void
  onAddTask: () => void
  onImport: () => void
  busy: boolean
}

export function TemplateStart({ canEdit, defaultStart, onUseTemplate, onAddTask, onImport, busy }: TemplateStartProps) {
  const [start, setStart] = useState<string>(defaultStart)
  if (!canEdit) return <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>No programme yet. Someone with Edit access to Solar can add one.</p>
  return (
    <div role="region" aria-label="Start the programme" style={{ padding: 24, border: '1px dashed var(--c-border)', borderRadius: 8, display: 'grid', gap: 12, maxWidth: 520 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>No programme yet</h2>
      <p style={{ margin: 0, fontSize: 13 }}>Start from your organisation’s standard solar programme — design, SSEG approval, procurement, installation, commissioning and handover — dated from the day you choose. You can change everything afterwards.</p>
      <label style={{ fontSize: 13 }}>Programme starts <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="btn-primary-amber" disabled={busy || !isCalendarDate(start)} onClick={() => onUseTemplate(start)}>Use template</button>
        <button type="button" onClick={onAddTask}>Add a task instead</button>
        <button type="button" onClick={onImport}>Import a programme</button>
      </div>
    </div>
  )
}
