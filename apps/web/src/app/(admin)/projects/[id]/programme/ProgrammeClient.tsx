'use client'

/**
 * The programme screen: toolbar, then a split view (grid left, resizable 30–70 %, timeline
 * right) sharing one vertical scroll. State, saves and undo/redo live in `useProgrammeStore`;
 * the grid, timeline and toolbar receive the store as a prop. The grid and the timeline each
 * scroll themselves and share one `scrollTop` (and one collapse set), so their rows line up.
 * Tasks 5–6 replace the timeline and toolbar placeholders below.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import { HEADER_HEIGHT, outlineRows, ROW_HEIGHT } from '@esite/shared/programme'
import type { ProgrammeSummary, ProgrammeViewData } from '@/lib/programme/view-types'
import { PROGRAMME_STALE } from '@/lib/programme/action-types'
import { useProgrammeStore, type ProgrammeStoreApi } from './use-programme-store'
import { GanttGrid } from './GanttGrid'

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

export function ProgrammeClient({ view, canEdit, userId }: {
  projectId: string
  view: ProgrammeViewData
  canEdit: boolean
  programmes: ProgrammeSummary[]
  /** Keys the grid's remembered column choice; without it the choice is per browser. */
  userId?: string | null
}) {
  const store = useProgrammeStore(view, { canEdit })
  const [split, setSplit] = useState(45)
  const [scrollTop, setScrollTop] = useState(0)
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())
  const toggleCollapsed = useCallback((id: string) => setCollapsed((c) => {
    const next = new Set(c)
    if (next.has(id)) next.delete(id)
    else next.add(id)
    return next
  }), [])

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
        left={<GanttGrid store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop}
          collapsed={collapsed} onToggleCollapsed={toggleCollapsed} userId={userId} />}
        right={<TimelinePlaceholder store={store} collapsed={collapsed} scrollTop={scrollTop} onScrollTop={setScrollTop} />} />
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

/** Grid left (`split` %) and timeline right, each scrolling itself, with a pointer-driven splitter. */
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
      style={{ display: 'flex', alignItems: 'stretch', height: 'calc(100vh - 220px)', minHeight: 320, border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden' }}>
      <div data-testid="programme-grid-pane" style={{ flex: `0 0 ${split}%`, minWidth: 0, overflow: 'hidden' }}>{left}</div>
      <div role="separator" aria-orientation="vertical" aria-label="Resize the grid"
        aria-valuemin={SPLIT_MIN} aria-valuemax={SPLIT_MAX} aria-valuenow={Math.round(split)} tabIndex={0}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp}
        onKeyDown={(e) => {
          if (e.key === 'ArrowLeft') { e.preventDefault(); onSplit(clampSplit(split - 2)) }
          if (e.key === 'ArrowRight') { e.preventDefault(); onSplit(clampSplit(split + 2)) }
        }}
        style={{ flex: '0 0 6px', cursor: 'col-resize', touchAction: 'none', background: 'var(--c-border)' }} />
      <div style={{ flex: '1 1 auto', minWidth: 0, overflow: 'hidden' }}>{right}</div>
    </div>
  )
}

function useRows(store: ProgrammeStoreApi, collapsed: ReadonlySet<string>) {
  const activities = store.state.activities
  return useMemo(() => {
    const byId = new Map(activities.map((a) => [a.id, a]))
    return outlineRows(activities, collapsed).flatMap((r) => {
      const activity = byId.get(r.id)
      return activity ? [{ ...r, activity }] : []
    })
  }, [activities, collapsed])
}

/** Placeholder until Task 5: each row's scheduled dates, scrolled with the grid. */
function TimelinePlaceholder({ store, collapsed, scrollTop, onScrollTop }: {
  store: ProgrammeStoreApi; collapsed: ReadonlySet<string>; scrollTop: number; onScrollTop: (top: number) => void
}) {
  const rows = useRows(store, collapsed)
  const box = useRef<HTMLDivElement>(null)
  useEffect(() => {
    const el = box.current
    if (el && Math.abs(el.scrollTop - scrollTop) > 0.5) el.scrollTop = scrollTop
  }, [scrollTop])
  return (
    <div ref={box} data-testid="programme-timeline-scroll" onScroll={(e) => onScrollTop(e.currentTarget.scrollTop)}
      style={{ height: '100%', overflow: 'auto' }}>
      <div style={{ position: 'sticky', top: 0, height: HEADER_HEIGHT, background: 'var(--c-panel)', borderBottom: '1px solid var(--c-border)' }} />
      <ol aria-label="Timeline" style={{ listStyle: 'none', margin: 0, padding: 0 }}>
        {rows.map((r) => {
          const s = store.schedule.activities.get(r.id)
          return (
            <li key={r.id} style={{ height: ROW_HEIGHT, display: 'flex', alignItems: 'center', paddingLeft: 8, fontSize: 13, boxSizing: 'border-box',
              color: s?.isCritical ? 'var(--c-red)' : 'var(--c-text)' }}>
              {s ? `${s.earlyStart} – ${s.earlyFinish}` : '—'}
            </li>
          )
        })}
      </ol>
    </div>
  )
}
