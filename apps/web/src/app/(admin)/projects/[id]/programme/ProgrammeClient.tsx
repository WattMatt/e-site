'use client'

/**
 * The programme screen: toolbar, then a split view (grid left, resizable 30–70 %, timeline
 * right) sharing one vertical scroll. State, saves and undo/redo live in `useProgrammeStore`;
 * the grid, timeline and toolbar receive the store as a prop. The grid and the timeline each
 * scroll themselves and share one `scrollTop`, one collapse set, one selection (a bar
 * click selects its grid row) and one list of rows (filters and grouping), so their rows line
 * up. The toolbar owns every button; the panes register the commands those buttons call.
 */
import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react'
import type { Zoom } from '@esite/shared/programme'
import type { ProgrammeSummary, ProgrammeViewData } from '@/lib/programme/view-types'
import { PROGRAMME_STALE } from '@/lib/programme/action-types'
import { usePhoneViewport } from '@/lib/mobile/use-phone-viewport'
import { useProgrammeStore } from './use-programme-store'
import { GanttGrid, GRID_COLUMNS, useHiddenColumns, type ColumnId, type GridSelection } from './GanttGrid'
import { GanttTimeline } from './GanttTimeline'
import { GanttToolbar } from './GanttToolbar'
import { buildDisplayRows, filtersActive, GROUP_BY_WBS, NO_FILTERS, type Filters, type GroupBy } from './display-rows'
import { NO_GRID_UI, type GridCommands, type GridUi, type TimelineCommands } from './bridge'

export const SPLIT_MIN = 30
export const SPLIT_MAX = 70
/** On a phone the grid keeps only these; every other hideable column is hidden. */
export const PHONE_COLUMNS: readonly ColumnId[] = ['name', 'start', 'finish']
const PHONE_HIDDEN: ColumnId[] = GRID_COLUMNS.filter((c) => !PHONE_COLUMNS.includes(c.id)).map((c) => c.id)
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

export function ProgrammeClient({ projectId, view, canEdit, programmes, userId }: {
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
  const [selection, setSelection] = useState<GridSelection>(() => ({ ids: new Set(), anchor: null }))
  const selectFromTimeline = useCallback((id: string, mode: 'only' | 'toggle') => setSelection((s) => {
    if (mode === 'only') return { ids: new Set([id]), anchor: id }
    const ids = new Set(s.ids)
    if (ids.has(id)) ids.delete(id)
    else ids.add(id)
    return { ids, anchor: id }
  }), [])
  const [zoom, setZoom] = useState<Zoom>('week')
  const [filters, setFilters] = useState<Filters>(NO_FILTERS)
  const [groupBy, setGroupBy] = useState<GroupBy>(GROUP_BY_WBS)
  const columns = useHiddenColumns(userId)
  const phone = usePhoneViewport()
  const [showTimeline, setShowTimeline] = useState(false)
  const gridCommands = useRef<GridCommands | null>(null)
  const timelineCommands = useRef<TimelineCommands | null>(null)
  const [gridUi, setGridUi] = useState<GridUi>(NO_GRID_UI)

  const structureLocked = filtersActive(filters) || groupBy !== GROUP_BY_WBS
  const rows = useMemo(
    () => buildDisplayRows(store.state, store.schedule, { collapsed, filters, groupBy }),
    [store.state, store.schedule, collapsed, filters, groupBy],
  )

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
      <GanttToolbar projectId={projectId} store={store} canEdit={canEdit} programmes={programmes} baselines={view.baselines}
        zoom={zoom} onZoom={setZoom} gridCommands={gridCommands} gridUi={gridUi} timelineCommands={timelineCommands}
        columns={columns} filters={filters} onFilters={setFilters} groupBy={groupBy} onGroupBy={setGroupBy} />
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
      {phone && (
        <div style={{ marginBottom: 8 }}>
          <button type="button" style={button} aria-pressed={showTimeline} onClick={() => setShowTimeline((v) => !v)}>Timeline</button>
        </div>
      )}
      <SplitView split={split} onSplit={setSplit} phone={phone} showTimeline={showTimeline}
        left={<GanttGrid store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop}
          collapsed={collapsed} onToggleCollapsed={toggleCollapsed} rows={rows} hiddenColumns={phone ? PHONE_HIDDEN : columns.hidden} fitColumns={phone}
          commandsRef={gridCommands} onUi={setGridUi} structureLocked={structureLocked} selection={selection} onSelection={setSelection} />}
        right={<GanttTimeline store={store} canEdit={canEdit} scrollTop={scrollTop} onScrollTop={setScrollTop}
          collapsed={collapsed} selected={selection.ids} onSelect={selectFromTimeline}
          activeBaseline={view.activeBaseline} zoom={zoom} onZoom={setZoom} rows={rows} commandsRef={timelineCommands} />} />
    </div>
  )
}

/** Grid left (`split` %) and timeline right, each scrolling itself, with a pointer-driven splitter. */
function SplitView({ split, onSplit, left, right, phone, showTimeline }: {
  split: number; onSplit: (n: number) => void; left: ReactNode; right: ReactNode
  /** Below 768 px one pane at a time: the grid, or the timeline once its toggle is pressed. */
  phone: boolean; showTimeline: boolean
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
  if (phone) {
    return (
      <div ref={box} data-testid="programme-split"
        style={{ height: 'calc(100vh - 260px)', minHeight: 320, border: '1px solid var(--c-border)', borderRadius: 8, overflow: 'hidden', maxWidth: '100%' }}>
        {showTimeline
          ? <div style={{ height: '100%', minWidth: 0 }}>{right}</div>
          : <div data-testid="programme-grid-pane" style={{ height: '100%', minWidth: 0 }}>{left}</div>}
      </div>
    )
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
