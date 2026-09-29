'use client'
/**
 * The toolbar's "Use template" (spec §14.1: "dates relative to a chosen start
 * date"). Same start-date choice as the empty state; on a schedule that already
 * has tasks, a two-step confirm that says how many tasks will be added, because
 * a template is one bulk insert that Undo does not cover.
 */
import { useState } from 'react'
import { isCalendarDate, type CalendarDate } from '@esite/shared'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export interface TemplateDialogProps {
  defaultStart: CalendarDate
  /** Tasks already in the programme. */
  existingCount: number
  /** Tasks the template will add; null while it is being read. */
  templateCount: number | null
  busy: boolean
  onApply: (start: CalendarDate) => void
  onClose: () => void
}

const tasks = (n: number, what = '') => `${n} ${what}${n === 1 ? 'task' : 'tasks'}`

export function TemplateDialog({ defaultStart, existingCount, templateCount, busy, onApply, onClose }: TemplateDialogProps) {
  const [start, setStart] = useState<string>(defaultStart)
  const confirm = useArmedConfirm(8000)
  const ready = templateCount !== null && !busy && isCalendarDate(start)
  return (
    <div role="dialog" aria-modal="true" aria-label="Use template" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', border: '1px solid var(--c-border)', padding: 16, borderRadius: 8, width: 420, maxWidth: 'calc(100vw - 32px)', fontSize: 13, display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Use template</h2>
        <p style={{ margin: 0 }}>Your organisation’s standard solar programme, dated from the day you choose.</p>
        <label>Programme starts <input type="date" value={start} onChange={(e) => { setStart(e.target.value); confirm.disarm() }} /></label>
        {templateCount === null && <div style={{ color: 'var(--c-text-dim)' }}>Reading your organisation’s template…</div>}
        {confirm.armed && templateCount !== null && (
          <div role="alert">{`Add ${tasks(templateCount, 'template ')} to the ${existingCount} already in the programme? A template cannot be undone — you would delete its tasks one by one.`}</div>
        )}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
          <button type="button" onClick={() => { confirm.disarm(); onClose() }}>Cancel</button>
          {confirm.armed && templateCount !== null ? (
            <button type="button" className="btn-primary-amber" disabled={!ready} onClick={() => { confirm.disarm(); onApply(start as CalendarDate) }}>
              {`Confirm: add ${tasks(templateCount)}`}
            </button>
          ) : (
            <button type="button" className="btn-primary-amber" disabled={!ready}
              onClick={() => { if (existingCount > 0) confirm.arm(); else onApply(start as CalendarDate) }}>
              {templateCount === null ? 'Use template' : `Add ${tasks(templateCount, 'template ')}`}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
