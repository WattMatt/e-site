'use client'
/**
 * Bulk actions on the selection (spec §14.2): status, colour, progress, owner,
 * and a two-step Delete that names the count. Rendered only at Edit. Owner
 * options are the Solar-eligible list only (owner decision Q4).
 */
import { GANTT_STATUSES, GANTT_STATUS_LABELS, type GanttStatus } from '@esite/shared'
import type { ScheduleOwner } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { SCHEDULE_COLOURS } from './TaskDialog'

export interface BulkBarProps {
  count: number
  owners: ScheduleOwner[]
  colours: string[]
  onSetStatus: (s: GanttStatus) => void
  onSetColour: (c: string) => void
  onSetProgress: (p: number) => void
  onSetOwner: (id: string) => void
  onDelete: () => void
  onClear: () => void
}

export function BulkBar({ count, owners, colours, onSetStatus, onSetColour, onSetProgress, onSetOwner, onDelete, onClear }: BulkBarProps) {
  const del = useArmedConfirm()
  const noun = `${count} ${count === 1 ? 'task' : 'tasks'}`
  return (
    <div role="region" aria-label="Selected tasks" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 8px', background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)', borderRadius: 6, fontSize: 12 }}>
      <strong>{`${count} selected`}</strong>
      <select aria-label="Set status" value="" onChange={(e) => { if (e.target.value) onSetStatus(e.target.value as GanttStatus) }}>
        <option value="">Status…</option>
        {GANTT_STATUSES.map((s) => <option key={s} value={s}>{GANTT_STATUS_LABELS[s]}</option>)}
      </select>
      <select aria-label="Set colour" value="" onChange={(e) => { if (e.target.value) onSetColour(e.target.value) }}>
        <option value="">Colour…</option>
        {[...new Set([...colours, ...SCHEDULE_COLOURS])].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <span role="group" aria-label="Set progress" style={{ display: 'inline-flex', gap: 2, alignItems: 'center' }}>
        Progress {[0, 25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => onSetProgress(p)}>{`${p}%`}</button>)}
      </span>
      <select aria-label="Set owner" value="" onChange={(e) => { if (e.target.value) onSetOwner(e.target.value) }}>
        <option value="">Owner…</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {del.armed
        ? <button type="button" onClick={() => { del.disarm(); onDelete() }}>{`Confirm: delete ${noun}`}</button>
        : <button type="button" onClick={del.arm}>{`Delete ${noun}`}</button>}
      <button type="button" onClick={onClear}>Clear selection</button>
    </div>
  )
}
