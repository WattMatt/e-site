'use client'

/**
 * The programme screen: toolbar, then a split view (grid left, resizable 30–70 %, timeline
 * right) sharing one vertical scroll. State, saves and undo/redo live in `useProgrammeStore`;
 * the grid, timeline and toolbar receive the store as a prop. Tasks 4–6 replace the three
 * placeholders below with the real grid, timeline and toolbar.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { outlineRows } from '@esite/shared/programme'
import type { ProgrammeSummary, ProgrammeViewData } from '@/lib/programme/view-types'
import { PROGRAMME_STALE } from '@/lib/programme/action-types'
import { useProgrammeStore, type ProgrammeStoreApi } from './use-programme-store'

export const SPLIT_MIN = 30
export const SPLIT_MAX = 70
const clampSplit = (n: number) => Math.min(SPLIT_MAX, Math.max(SPLIT_MIN, n))

/** True when keystrokes belong to a field, not to the screen. */
function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}

const button: CSSProperties = {
  padding: '6px 12px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 13, cursor: 'pointer',
}
const banner = (tone: 'red' | 'amber'): CSSProperties => ({
  display: 'flex', alignItems: 'center', gap: 12, padding: '10px 14px', borderRadius: 8, marginBottom: 12,
  border: `1px solid var(--c-${tone})`, color: 'var(--c-text)', fontSize: 14,
})

export function ProgrammeClient({ view, canEdit }: {
  projectId: string
  view: ProgrammeViewData
  canEdit: boolean
  programmes: ProgrammeSummary[]
}) {
  const store = useProgrammeStore(view, { canEdit })
  const [split, setSplit] = useState(45)

  // ⌘/Ctrl+Z undo, ⇧⌘/Ctrl+Z redo; ignored while a field has focus.
  const { undo, redo } = store
  useEffect(() => {
    if (!canEdit) return
    const onKey = (e: KeyboardEvent) => {
      if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z' || typingInField(e.target)) return
      e.preventDefault()
      if (e.shiftKey) redo()
      else undo()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [canEdit, undo, redo])

  return (
    <div className="page">
      <div className="page-header"><h1 className="page-title">{store.state.programme.name}</h1></div>
      <ToolbarPlaceholder store={store} canEdit={canEdit} />
      {store.stale && (
        <div role="alert" style={banner('amber')} data-testid="programme-stale">
          <span>{PROGRAMME_STALE}{store.unsaved ? ' Your unsaved changes are still shown here; they were not saved.' : ''}</span>
          <button type="button" className="btn-primary-amber" onClick={store.reload}>Reload</button>
        </div>
      )}
      {store.error && (
        <div role="alert" style={banner('red')} data-testid="programme-error">
          <span>{store.error}</span>
          {store.offerReload
            ? <button type="button" style={button} onClick={store.reload}>Reload</button>
            : <button type="button" style={button} onClick={store.clearError}>Dismiss</button>}
        </div>
      )}
      <SplitView split={split} onSplit={setSplit}
        left={<GridPlaceholder store={store} />}
        right={<TimelinePlaceholder store={store} />} />
    </div>
  )
}

function ToolbarPlaceholder({ store, canEdit }: { store: ProgrammeStoreApi; canEdit: boolean }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
      {canEdit && (
        <>
          <button type="button" style={button} onClick={store.undo} disabled={!store.canUndo}
            title={store.undoLabel ? `Undo ${store.undoLabel}` : undefined}>Undo</button>
          <button type="button" style={button} onClick={store.redo} disabled={!store.canRedo}
            title={store.redoLabel ? `Redo ${store.redoLabel}` : undefined}>Redo</button>
        </>
      )}
      <span style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>
        Finish: <span data-testid="programme-finish">{store.schedule.projectFinish ?? '—'}</span>
      </span>
      {store.pending && <span style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>Saving…</span>}
      {!store.pending && store.unsaved && <span style={{ color: 'var(--c-text-dim)', fontSize: 13 }}>Not saved</span>}
    </div>
  )
}

/** Grid left (`split` %) and timeline right in ONE vertical scroll container, with a pointer-driven splitter. */
function SplitView({ split, onSplit, left, right }: {
  split: number; onSplit: (n: number) => void; left: ReactNode; right: ReactNode
}) {
  const box = useRef<HTMLDivElement>(null)
  const dragging = useRef(false)
  const toPercent = useCallback((clientX: number) => {
    const r = box.current?.getBoundingClientRect()
    if (!r || r.width <= 0) return null
    return clampSplit(((clientX - r.left) / r.width) * 100)
  }, [])
  const onDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = true
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (!dragging.current) return
    const p = toPercent(e.clientX)
    if (p !== null) onSplit(p)
  }
  const onUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    dragging.current = false
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }
  return (
    <div ref={box} data-testid="programme-split"
      style={{ display: 'flex', alignItems: 'stretch', overflowY: 'auto', maxHeight: 'calc(100vh - 220px)', border: '1px solid var(--c-border)', borderRadius: 8 }}>
      <div data-testid="programme-grid-pane" style={{ flex: `0 0 ${split}%`, minWidth: 0, overflowX: 'auto' }}>{left}</div>
      <div role="separator" aria-orientation="vertical" aria-label="Resize the grid"
        aria-valuemin={SPLIT_MIN} aria-valuemax={SPLIT_MAX} aria-valuenow={Math.round(split)} tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); onSplit(clampSplit(split - 2)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); onSplit(clampSplit(split + 2)) }
        }}
        style={{ flex: '0 0 6px', cursor: 'col-resize', touchAction: 'none', background: 'var(--c-border)' }} />
      <div style={{ flex: '1 1 auto', minWidth: 0, overflowX: 'auto' }}>{right}</div>
    </div>
  )
}

function useRows(store: ProgrammeStoreApi) {
  const activities = store.state.activities
  return useMemo(() => {
    const byId = new Map(activities.map((a) => [a.id, a]))
    return outlineRows(activities, new Set()).flatMap((r) => {
      const activity = byId.get(r.id)
      return activity ? [{ ...r, activity }] : []
    })
  }, [activities])
}

/** Placeholder until Task 4: the outline rows by WBS and name. */
function GridPlaceholder({ store }: { store: ProgrammeStoreApi }) {
  const rows = useRows(store)
  if (rows.length === 0) return <p style={{ padding: 12, color: 'var(--c-text-dim)' }}>No activities yet.</p>
  return (
    <ol aria-label="Activities" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((r) => (
        <li key={r.id} style={{ height: 28, display: 'flex', alignItems: 'center', paddingLeft: 8 + r.depth * 16, fontSize: 13 }}>
          <span style={{ color: 'var(--c-text-dim)', marginRight: 8 }}>{r.wbs}</span>{r.activity.name}
        </li>
      ))}
    </ol>
  )
}

/** Placeholder until Task 5: each row's scheduled dates. */
function TimelinePlaceholder({ store }: { store: ProgrammeStoreApi }) {
  const rows = useRows(store)
  return (
    <ol aria-label="Timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
      {rows.map((r) => {
        const s = store.schedule.activities.get(r.id)
        return (
          <li key={r.id} style={{ height: 28, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 13,
            color: s?.isCritical ? 'var(--c-red)' : 'var(--c-text)' }}>
            {s ? `${s.earlyStart} – ${s.earlyFinish}` : '—'}
          </li>
        )
      })}
    </ol>
  )
}
