'use client'
/**
 * The DOM half of the Gantt: the same ScheduleRow[] the Konva timeline draws,
 * at the same GANTT_HEADER_HEIGHT / GANTT_ROW_HEIGHT, so a name always sits
 * beside its bar — group headers included (WM grouped the list but drew the
 * bars flat, D4). Checkboxes and drag handles need Edit and are not rendered
 * below it. Reorder reports (movedIds, beforeId); the caller resolves that
 * against the FULL task list with reorderTaskIds.
 */
import type { KeyboardEvent } from 'react'
import { GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type ScheduleRow } from '@esite/shared'

export interface ScheduleRowListProps {
  rows: ScheduleRow[]
  canEdit: boolean
  selected: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  onToggleGroup: (key: string) => void
  onOpenTask: (id: string) => void
  /** `beforeId` null = move to the end. */
  onReorder: (movedIds: string[], beforeId: string | null) => void
}

export const SCHEDULE_ROW_LIST_WIDTH = 340

export function ScheduleRowList({ rows, canEdit, selected, onToggleSelect, onToggleGroup, onOpenTask, onReorder }: ScheduleRowListProps) {
  const taskIds = rows.flatMap((r) => (r.kind === 'task' ? [r.task.id] : []))

  /** The rows a drag of `id` carries: the whole selection if `id` is in it (in row order), else just `id`. */
  function carried(id: string): string[] {
    if (!selected.has(id)) return [id]
    const shown = taskIds.filter((x) => selected.has(x))
    const hidden = [...selected].filter((x) => !shown.includes(x))
    return [...shown, ...hidden]
  }

  function onHandleKey(e: KeyboardEvent, id: string) {
    if (!e.altKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return
    e.preventDefault()
    const i = taskIds.indexOf(id)
    if (e.key === 'ArrowUp') {
      if (i > 0) onReorder([id], taskIds[i - 1])
      return
    }
    if (i >= 0 && i < taskIds.length - 1) onReorder([id], taskIds[i + 2] ?? null)
  }

  return (
    <div style={{ width: SCHEDULE_ROW_LIST_WIDTH, flex: `0 0 ${SCHEDULE_ROW_LIST_WIDTH}px`, borderRight: '1px solid var(--c-border)', fontSize: 12 }}>
      <div style={{ height: GANTT_HEADER_HEIGHT, borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'flex-end', padding: '0 8px 4px', color: 'var(--c-text-dim)', boxSizing: 'border-box' }}>Task</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}
        onDragOver={(e) => { if (canEdit) e.preventDefault() }}>
        {rows.map((r) => {
          if (r.kind === 'group') {
            return (
              <li key={r.key} style={{ height: GANTT_ROW_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center', paddingLeft: 8 + r.depth * 14, background: 'var(--c-surface-2, var(--c-surface))', fontWeight: 600 }}>
                <button type="button" aria-expanded={!r.collapsed} aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${r.label} (${r.count})`} onClick={() => onToggleGroup(r.key)}
                  style={{ background: 'none', border: 0, padding: 0, font: 'inherit', cursor: 'pointer' }}>
                  {r.collapsed ? '▸' : '▾'} {r.label} ({r.count})
                </button>
              </li>
            )
          }
          const t = r.task
          return (
            <li key={t.id} style={{ height: GANTT_ROW_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8 + r.depth * 14, paddingRight: 8, borderBottom: '1px solid var(--c-border)' }}
              onDrop={(e) => {
                if (!canEdit) return
                e.preventDefault()
                const dragged = e.dataTransfer.getData('text/plain')
                if (!dragged) return
                const moved = carried(dragged)
                if (moved.includes(t.id)) return // dropped onto itself or onto a row it is carrying
                onReorder(moved, t.id)
              }}>
              {canEdit && (
                <>
                  <span role="button" tabIndex={0} aria-label="Drag to reorder" title="Drag to reorder (or Alt + ↑ / ↓)" draggable style={{ cursor: 'grab', color: 'var(--c-text-dim)' }}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}
                    onKeyDown={(e) => onHandleKey(e, t.id)}>⋮⋮</span>
                  <input type="checkbox" aria-label={`Select ${t.ref}`} checked={selected.has(t.id)} onChange={() => onToggleSelect(t.id)} />
                </>
              )}
              <span aria-hidden="true" style={{ width: 8, height: 8, borderRadius: t.isMilestone ? 0 : 2, transform: t.isMilestone ? 'rotate(45deg)' : undefined, background: t.colour, flex: '0 0 8px' }} />
              <button type="button" aria-label={`${t.ref} ${t.name}`} onClick={() => onOpenTask(t.id)}
                style={{ flex: 1, minWidth: 0, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 0, padding: 0, font: 'inherit', color: 'inherit', cursor: 'pointer' }}>
                <span style={{ color: 'var(--c-text-dim)' }}>{t.ref}</span> {t.name}
              </button>
              {t.awaitingSignOff && <span style={{ fontSize: 10, color: 'var(--c-amber)', whiteSpace: 'nowrap' }}>Awaiting sign-off</span>}
              {!t.isMilestone && <span style={{ fontSize: 10, minWidth: 30, textAlign: 'right' }}>{t.status === 'done' ? 100 : t.progress}%</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
