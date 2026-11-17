'use client'

/**
 * The programme's activity grid: a windowed list of absolutely positioned rows inside a
 * spacer of `rows × ROW_HEIGHT`, so 5,000 activities cost the same as 50.
 *
 * - The vertical scroll is shared with the timeline: `scrollTop` comes in as a prop and every
 *   scroll goes out through `onScrollTop`. A sticky header of `HEADER_HEIGHT` sits on top, so
 *   the timeline lines up when its header is the same height.
 * - Collapse state belongs to the screen (the timeline shows the same rows); selection,
 *   inline editing and the delete confirm belong to the grid.
 * - Every edit is ops through `store.apply` (structural gestures come from `grid-ops.ts`).
 *   Without `canEdit` no input, add, delete or keyboard edit exists at all.
 * - Column visibility is remembered in localStorage per user (per browser when the user is
 *   unknown); every access is wrapped, so a blocked store only means it is not remembered.
 *   The toolbar owns the picker (`useHiddenColumns`) and hands the grid `hiddenColumns`.
 * - The grid ends in no footer: Add / Indent / Outdent / Delete (and its inline confirm) live in
 *   the toolbar, which calls the commands the grid registers in `commandsRef` and reads
 *   `GridUi` from `onUi`.
 * - Rows come from `display-rows` (filters, grouping). A group header row toggles its group;
 *   it is never selected, edited or deleted.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type MouseEvent as ReactMouseEvent,
  type Dispatch, type PointerEvent as ReactPointerEvent, type SetStateAction,
} from 'react'
import { HEADER_HEIGHT, ROW_HEIGHT, visibleRange, type ActivityRow, type ProgrammeOp } from '@esite/shared/programme'
import type { ProgrammeStoreApi } from './use-programme-store'
import { addOps, deleteOps, deletionSet, indentOps, moveOps, outdentOps, type NewRowKind } from './grid-ops'
import { buildDisplayRows, NO_FILTERS, type DisplayRow } from './display-rows'
import { STRUCTURE_LOCKED, type CommandsRef, type GridCommands, type GridUi } from './bridge'

export type GanttGridStore = Pick<ProgrammeStoreApi, 'state' | 'schedule' | 'apply' | 'newKey' | 'keyIds'>

export type ColumnId = 'wbs' | 'name' | 'duration' | 'start' | 'finish' | 'float' | 'percent'
interface ColumnDef { id: ColumnId; label: string; width: number; hideable: boolean; align?: 'right' }
export const GRID_COLUMNS: readonly ColumnDef[] = [
  { id: 'wbs', label: 'WBS', width: 64, hideable: true },
  { id: 'name', label: 'Name', width: 260, hideable: false },
  { id: 'duration', label: 'Duration', width: 80, hideable: true, align: 'right' },
  { id: 'start', label: 'Start', width: 112, hideable: true },
  { id: 'finish', label: 'Finish', width: 104, hideable: true },
  { id: 'float', label: 'Total float', width: 84, hideable: true, align: 'right' },
  { id: 'percent', label: '% complete', width: 88, hideable: true, align: 'right' },
]
const NO_HIDDEN: ColumnId[] = []
const MIN_WIDTH = 40
const INDENT = 16
const OVERSCAN = 10

export const columnsStorageKey = (userId?: string | null) => `esite:programme-grid:hidden-columns:${userId || 'browser'}`

function readHidden(key: string): ColumnId[] {
  try {
    const raw = window.localStorage.getItem(key)
    if (!raw) return []
    const parsed: unknown = JSON.parse(raw)
    if (!Array.isArray(parsed)) return []
    return GRID_COLUMNS.filter((c) => c.hideable && parsed.includes(c.id)).map((c) => c.id)
  } catch {
    return []
  }
}
function writeHidden(key: string, hidden: ColumnId[]): void {
  try { window.localStorage.setItem(key, JSON.stringify(hidden)) } catch { /* not remembered */ }
}

/** The hidden columns (remembered per user) and how to flip one; the toolbar's Columns picker uses it. */
export function useHiddenColumns(userId?: string | null): { hidden: ColumnId[]; toggle: (id: ColumnId) => void } {
  const storageKey = columnsStorageKey(userId)
  const [hidden, setHidden] = useState<ColumnId[]>([])
  useEffect(() => { setHidden(readHidden(storageKey)) }, [storageKey])
  const toggle = useCallback((id: ColumnId) => {
    setHidden((h) => {
      const next = h.includes(id) ? h.filter((x) => x !== id) : [...h, id]
      writeHidden(storageKey, next)
      return next
    })
  }, [storageKey])
  return { hidden, toggle }
}

type EditCol = 'name' | 'duration' | 'start'
interface Editing { id: string; col: EditCol; value: string; invalid: boolean }

const isSummary = (a: ActivityRow) => a.type === 'summary' || a.type === 'module_summary'
const isMilestone = (a: ActivityRow) => a.type === 'start_milestone' || a.type === 'finish_milestone'
function editable(a: ActivityRow, col: string | null): col is EditCol {
  if (col === 'name') return true
  if (col === 'duration') return !isSummary(a) && !isMilestone(a)
  if (col === 'start') return !isSummary(a)
  return false
}

function typingInField(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false
  const tag = target.tagName
  return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable
}


/** Selected row ids (as given: a new row's `key:<k>` until its save) and the range anchor. */
export interface GridSelection { ids: ReadonlySet<string>; anchor: string | null }
const NO_SELECTION: GridSelection = { ids: new Set(), anchor: null }

export interface GanttGridProps {
  store: GanttGridStore
  canEdit: boolean
  scrollTop: number
  onScrollTop: (top: number) => void
  collapsed: ReadonlySet<string>
  onToggleCollapsed: (id: string) => void
  /** The rows to show (filters, grouping); without it, the plain outline. */
  rows?: DisplayRow[]
  /** Columns the toolbar has hidden. */
  hiddenColumns?: ColumnId[]
  /** Filters or grouping hide part of the outline: structural edits are refused. */
  structureLocked?: boolean
  /** The toolbar's Add / Indent / Outdent / Delete call these. */
  commandsRef?: CommandsRef<GridCommands>
  /** What those buttons need to show: the selection size, a delete awaiting its confirm, a refusal sentence. */
  onUi?: (ui: GridUi) => void
  /** Selection owned by the screen (the timeline selects bars too); the grid keeps its own without it. */
  selection?: GridSelection
  onSelection?: Dispatch<SetStateAction<GridSelection>>
}

export function GanttGrid({
  store, canEdit, scrollTop, onScrollTop, collapsed, onToggleCollapsed, rows: rowsProp, hiddenColumns, commandsRef, onUi, structureLocked = false, selection, onSelection,
}: GanttGridProps) {
  const { state, schedule, apply, newKey, keyIds } = store
  const activities = state.activities

  // ── rows ──
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities])
  const rows = useMemo(
    () => rowsProp ?? buildDisplayRows(state, schedule, { collapsed, filters: NO_FILTERS, groupBy: 'wbs' }),
    [rowsProp, state, schedule, collapsed],
  )
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])

  // ── scroll + viewport ──
  const scroller = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setViewport(el.clientHeight)
    measure()
    if (typeof ResizeObserver !== 'undefined') {
      const ro = new ResizeObserver(measure)
      ro.observe(el)
      return () => ro.disconnect()
    }
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [])
  useEffect(() => {
    const el = scroller.current
    if (el && Math.abs(el.scrollTop - scrollTop) > 0.5) el.scrollTop = scrollTop
  }, [scrollTop])
  const { first, last } = visibleRange(scrollTop, viewport - HEADER_HEIGHT, rows.length, ROW_HEIGHT, OVERSCAN)

  // ── columns ──
  const hidden = hiddenColumns ?? NO_HIDDEN
  const [widths, setWidths] = useState<Record<ColumnId, number>>(
    () => Object.fromEntries(GRID_COLUMNS.map((c) => [c.id, c.width])) as Record<ColumnId, number>,
  )
  const columns = GRID_COLUMNS.filter((c) => !hidden.includes(c.id))
  const totalWidth = columns.reduce((s, c) => s + widths[c.id], 0)
  const resizing = useRef<{ id: ColumnId; x: number; w: number } | null>(null)
  const onResizeDown = (id: ColumnId) => (e: ReactPointerEvent<HTMLDivElement>) => {
    e.stopPropagation()
    resizing.current = { id, x: e.clientX, w: widths[id] }
    e.currentTarget.setPointerCapture?.(e.pointerId)
  }
  const onResizeMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const r = resizing.current
    if (!r) return
    setWidths((w) => ({ ...w, [r.id]: Math.max(MIN_WIDTH, r.w + (e.clientX - r.x)) }))
  }
  const onResizeUp = (e: ReactPointerEvent<HTMLDivElement>) => {
    resizing.current = null
    e.currentTarget.releasePointerCapture?.(e.pointerId)
  }

  // ── selection ──
  // Ids are held as given (a new row's `key:<k>`) and resolved through the store's
  // key → uuid map, so a save landing mid-gesture keeps the selection and the open editor.
  const resolve = useCallback((id: string) => keyIds[id] ?? id, [keyIds])
  const [ownSelection, setOwnSelection] = useState<GridSelection>(NO_SELECTION)
  const { ids: selectedRaw, anchor: anchorRaw } = selection ?? ownSelection
  const setSelection = onSelection ?? setOwnSelection
  const setSelected = useCallback((ids: ReadonlySet<string>) => setSelection((s) => ({ ...s, ids })), [setSelection])
  const setAnchor = useCallback((anchor: string | null) => setSelection((s) => ({ ...s, anchor })), [setSelection])
  const [activeCol, setActiveCol] = useState<ColumnId>('name')
  /** A delete awaiting its confirm: the rows chosen (`roots`) and every row it removes (`ids`). */
  const [armed, setArmed] = useState<{ roots: string[]; ids: string[] } | null>(null)
  const [notice, setNotice] = useState<string | null>(null)
  /** Only rows that are shown: a row hidden by a collapse is never acted on. */
  const selected = useMemo(
    () => new Set([...selectedRaw].map(resolve).filter((id) => indexOf.has(id))) as ReadonlySet<string>,
    [selectedRaw, resolve, indexOf],
  )
  const anchor = anchorRaw === null ? null : resolve(anchorRaw)
  // Any change of selection (a row, a key, a bar click in the timeline) withdraws an armed delete:
  // its sentence named the rows selected when it was asked for.
  useEffect(() => { setArmed(null) }, [selectedRaw])
  const primary = anchor !== null && selected.has(anchor) ? anchor : null

  const selectOnly = useCallback((id: string) => { setSelection({ ids: new Set([id]), anchor: id }); setArmed(null) }, [setSelection])
  const ensureVisible = (index: number) => {
    const top = index * ROW_HEIGHT
    const body = Math.max(ROW_HEIGHT, viewport - HEADER_HEIGHT)
    if (top < scrollTop) onScrollTop(top)
    else if (top + ROW_HEIGHT > scrollTop + body) onScrollTop(top + ROW_HEIGHT - body)
  }

  const onRowClick = (e: ReactMouseEvent<HTMLDivElement>, id: string) => {
    const col = (e.target as HTMLElement).closest('[data-col]')?.getAttribute('data-col') as ColumnId | null
    if (col) setActiveCol(col)
    setArmed(null)
    setNotice(null)
    if (e.shiftKey && anchor !== null && indexOf.has(anchor)) {
      const [a, b] = [indexOf.get(anchor)!, indexOf.get(id)!].sort((x, y) => x - y)
      setSelected(new Set(rows.slice(a, b + 1).filter((r) => r.kind === 'activity').map((r) => r.id)))
    } else if (e.metaKey || e.ctrlKey) {
      const next = new Set(selected)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      setSelected(next)
      setAnchor(id)
    } else {
      selectOnly(id)
    }
    scroller.current?.focus({ preventScroll: true })
  }

  // ── editing ──
  const [editingRaw, setEditing] = useState<Editing | null>(null)
  const editing = editingRaw === null ? null : { ...editingRaw, id: resolve(editingRaw.id) }
  const startEdit = (a: ActivityRow, col: EditCol) => {
    if (!canEdit || !editable(a, col)) return
    const value = col === 'name' ? a.name
      : col === 'duration' ? String(a.original_duration)
      : schedule.activities.get(a.id)?.earlyStart ?? a.constraint_date ?? ''
    setEditing({ id: a.id, col, value, invalid: false })
  }
  const onRowDoubleClick = (e: ReactMouseEvent<HTMLDivElement>, a: ActivityRow) => {
    const col = (e.target as HTMLElement).closest('[data-col]')?.getAttribute('data-col') ?? null
    if (editable(a, col)) startEdit(a, col)
  }
  /** True when the edit closed (committed or nothing to do); false keeps it open as invalid. */
  const commit = (ed: Editing): boolean => {
    const a = byId.get(resolve(ed.id))
    if (!a) return true
    let op: ProgrammeOp | null = null
    let label = ''
    if (ed.col === 'name') {
      const name = ed.value.trim()
      if (name === '' || name.length > 300) return false
      if (name !== a.name) { op = { op: 'upsert_activity', id: a.id, fields: { name } }; label = 'Rename' }
    } else if (ed.col === 'duration') {
      // Working days, up to two decimals (the column is NUMERIC); more than zero.
      const m = /^\s*(\d{1,5}(?:\.\d{1,2})?)\s*d?\s*$/i.exec(ed.value)
      const n = m ? Number(m[1]) : NaN
      if (!(n > 0)) return false
      if (n !== a.original_duration) { op = { op: 'upsert_activity', id: a.id, fields: { original_duration: n } }; label = 'Change duration' }
    } else {
      const d = ed.value.trim()
      if (!/^\d{4}-\d{2}-\d{2}$/.test(d)) return false
      const shown = schedule.activities.get(a.id)?.earlyStart ?? null
      const unchanged = a.constraint_type === 'snet' ? a.constraint_date === d : a.constraint_type === null && shown === d
      if (!unchanged) {
        op = { op: 'upsert_activity', id: a.id, fields: { constraint_type: 'snet', constraint_date: d } }
        label = 'Change start'
      }
    }
    if (op) apply([op], label)
    return true
  }

  // ── gestures ──
  /** After a gesture lands, scroll its row into view (and, for a new row, open its Name). */
  const reveal = useRef<{ id: string; edit: boolean } | null>(null)
  useEffect(() => {
    const r = reveal.current
    if (!r) return
    const id = resolve(r.id)
    const index = indexOf.get(id)
    if (index === undefined) return
    reveal.current = null
    ensureVisible(index)
    const a = byId.get(id)
    if (r.edit && a) startEdit(a, 'name')
    // eslint-disable-next-line react-hooks/exhaustive-deps -- runs when the rows change, not on every helper identity
  }, [rows, indexOf, resolve])

  const run = (ops: ProgrammeOp[], label: string) => {
    if (!canEdit || ops.length === 0) return
    if (primary !== null) reveal.current = { id: primary, edit: false }
    // A refused gesture changes no rows, so nothing must be left waiting to scroll later.
    if (!apply(ops, label)) reveal.current = null
  }
  const structure = (direction: 'indent' | 'outdent') => {
    if (!canEdit || selected.size === 0) return
    if (structureLocked) { setNotice(STRUCTURE_LOCKED); return }
    const g = direction === 'indent' ? indentOps(activities, selected) : outdentOps(activities, selected)
    setNotice(g.error)
    run(g.ops, direction === 'indent' ? 'Indent' : 'Outdent')
  }
  const add = (kind: NewRowKind) => {
    if (!canEdit) return
    if (structureLocked) { setNotice(STRUCTURE_LOCKED); return }
    const key = newKey()
    const after = primary ?? rows.filter((r) => selected.has(r.id)).at(-1)?.id ?? null
    setNotice(null)
    reveal.current = { id: `key:${key}`, edit: true }
    if (apply(addOps(activities, after, kind, key), kind === 'task' ? 'Add task' : 'Add milestone')) selectOnly(`key:${key}`)
    else reveal.current = null
  }
  const arm = () => { if (canEdit && selected.size > 0) setArmed({ roots: [...selected], ids: deletionSet(activities, selected) }) }
  /** Deletes exactly the rows that were confirmed (those still there), never the selection of the moment. */
  const confirmDelete = () => {
    const roots = armed?.roots.map(resolve).filter((id) => byId.has(id)) ?? []
    setArmed(null)
    if (!canEdit || roots.length === 0) return
    if (apply(deleteOps(activities, new Set(roots)), 'Delete')) { setSelected(new Set()); setAnchor(null) }
  }

  const cancelDelete = () => setArmed(null)
  const commands = useRef<GridCommands>({ add: () => {}, structure: () => {}, arm: () => {}, confirmDelete: () => {}, cancelDelete: () => {} })
  commands.current = { add, structure, arm, confirmDelete, cancelDelete }
  useEffect(() => {
    if (!commandsRef) return
    const stable: GridCommands = {
      add: (k) => commands.current.add(k), structure: (d) => commands.current.structure(d), arm: () => commands.current.arm(),
      confirmDelete: () => commands.current.confirmDelete(), cancelDelete: () => commands.current.cancelDelete(),
    }
    commandsRef.current = stable
    return () => { if (commandsRef.current === stable) commandsRef.current = null }
  }, [commandsRef])
  const selectedCount = selected.size
  const armedCount = armed === null ? null : armed.ids.length
  useEffect(() => { onUi?.({ selectedCount, armedCount, notice }) }, [onUi, selectedCount, armedCount, notice])

  const onGridKey = (e: ReactKeyboardEvent<HTMLDivElement>) => {
    if (typingInField(e.target)) return
    // ⌥⇧→ / ⌥⇧← indent and outdent (MS Project). Tab is never taken, so focus can leave.
    if (e.altKey && e.shiftKey && (e.key === 'ArrowRight' || e.key === 'ArrowLeft')) {
      if (!canEdit || selected.size === 0) return
      e.preventDefault()
      structure(e.key === 'ArrowRight' ? 'indent' : 'outdent')
      return
    }
    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
      e.preventDefault()
      if (e.altKey) {
        if (canEdit && structureLocked) { setNotice(STRUCTURE_LOCKED); return }
        run(moveOps(activities, selected, e.key === 'ArrowUp' ? 'up' : 'down'), e.key === 'ArrowUp' ? 'Move up' : 'Move down')
        return
      }
      if (rows.length === 0) return
      const at = primary !== null ? indexOf.get(primary) ?? -1 : -1
      const dir = e.key === 'ArrowUp' ? -1 : 1
      // Step over group headers: only activities are selected.
      let next = Math.max(0, Math.min(rows.length - 1, at + dir))
      while (rows[next].kind !== 'activity' && next + dir >= 0 && next + dir < rows.length) next += dir
      if (rows[next].kind !== 'activity') return
      selectOnly(rows[next].id)
      ensureVisible(next)
      return
    }
    if (e.key === 'Escape') {
      setArmed(null)
      setNotice(null)
      setSelected(new Set())
      setAnchor(null)
      return
    }
    if (!canEdit || selected.size === 0) return
    if (e.key === 'Enter') {
      const a = primary !== null ? byId.get(primary) : undefined
      if (!a) return
      e.preventDefault()
      startEdit(a, editable(a, activeCol) ? activeCol : 'name')
    } else if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      arm()
    }
  }

  // ── render ──
  const cellStyle = (c: ColumnDef): CSSProperties => ({
    width: widths[c.id], flex: `0 0 ${widths[c.id]}px`, padding: '0 6px', overflow: 'hidden', whiteSpace: 'nowrap',
    textOverflow: 'ellipsis', textAlign: c.align ?? 'left', boxSizing: 'border-box',
  })

  const visible = rows.slice(first, last)
  /** A re-keyed row keeps its React key (its first id), so an open editor is not remounted. */
  const originOf = new Map(Object.entries(keyIds).map(([k, id]) => [id, k]))
  return (
    <div data-testid="programme-grid" style={{ display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scroller} data-testid="programme-grid-scroll" role="grid" aria-label="Activities"
        aria-rowcount={rows.length + 1} aria-multiselectable tabIndex={0}
        onScroll={(e) => onScrollTop(e.currentTarget.scrollTop)} onKeyDown={onGridKey}
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'scroll', position: 'relative', outline: 'none', fontSize: 13 }}>
        <div role="row" style={{
          position: 'sticky', top: 0, zIndex: 2, display: 'flex', alignItems: 'center', height: HEADER_HEIGHT,
          width: totalWidth, minWidth: '100%', background: 'var(--c-panel)', borderBottom: '1px solid var(--c-border)',
          color: 'var(--c-text-dim)', fontSize: 12, fontWeight: 600,
        }}>
          {columns.map((c) => (
            <div key={c.id} role="columnheader" aria-label={c.label} style={{ ...cellStyle(c), position: 'relative', height: '100%', display: 'flex', alignItems: 'center', justifyContent: c.align === 'right' ? 'flex-end' : 'flex-start' }}>
              {c.label}
              <div role="separator" aria-orientation="vertical" aria-label={`Resize ${c.label}`} tabIndex={-1}
                onPointerDown={onResizeDown(c.id)} onPointerMove={onResizeMove} onPointerUp={onResizeUp} onPointerCancel={onResizeUp}
                style={{ position: 'absolute', right: 0, top: 0, bottom: 0, width: 6, cursor: 'col-resize', touchAction: 'none' }} />
            </div>
          ))}
        </div>
        <div data-testid="programme-grid-spacer" style={{ position: 'relative', height: rows.length * ROW_HEIGHT, width: totalWidth, minWidth: '100%' }}>
          {visible.map((r, k) => {
            const i = first + k
            if (r.kind === 'group') {
              return (
                <div key={r.id} role="row" data-group-id={r.id} aria-rowindex={i + 2}
                  onClick={() => onToggleCollapsed(r.id)}
                  style={{
                    position: 'absolute', top: i * ROW_HEIGHT, left: 0, height: ROW_HEIGHT, width: totalWidth, minWidth: '100%',
                    display: 'flex', alignItems: 'center', boxSizing: 'border-box', cursor: 'pointer', gap: 6, padding: '0 6px',
                    borderBottom: '1px solid var(--c-border-soft)', background: 'var(--c-border-soft)', fontWeight: 600, color: 'var(--c-text)',
                  }}>
                  <button type="button" aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${r.label}`} aria-expanded={!r.collapsed}
                    onClick={(e) => { e.stopPropagation(); onToggleCollapsed(r.id) }}
                    style={{ width: 16, flex: '0 0 16px', padding: 0, border: 'none', background: 'transparent', color: 'var(--c-text-dim)', cursor: 'pointer' }}>
                    {r.collapsed ? '▸' : '▾'}
                  </button>
                  <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{r.label}</span>
                  <span data-testid="programme-group-summary" style={{ color: 'var(--c-text-dim)', fontWeight: 400, whiteSpace: 'nowrap' }}>
                    {r.count === 1 ? '1 activity' : `${r.count} activities`}{r.start && r.finish ? ` · ${r.start} – ${r.finish}` : ''}
                  </span>
                </div>
              )
            }
            const a = r.activity
            const s = schedule.activities.get(a.id)
            const isSel = selected.has(a.id)
            return (
              <div key={originOf.get(a.id) ?? a.id} role="row" data-row-id={a.id} data-critical={s?.isCritical === true} aria-rowindex={i + 2} aria-selected={isSel}
                onClick={(e) => onRowClick(e, a.id)} onDoubleClick={(e) => onRowDoubleClick(e, a)}
                style={{
                  position: 'absolute', top: i * ROW_HEIGHT, left: 0, height: ROW_HEIGHT, width: totalWidth, minWidth: '100%',
                  display: 'flex', alignItems: 'center', boxSizing: 'border-box', cursor: 'default',
                  borderLeftWidth: 3, borderLeftStyle: 'solid', borderLeftColor: s?.isCritical ? 'var(--c-red)' : 'transparent',
                  borderBottom: '1px solid var(--c-border-soft)',
                  background: isSel ? 'var(--c-amber-dim)' : 'transparent',
                  fontWeight: isSummary(a) ? 600 : 400, color: 'var(--c-text)',
                }}>
                {columns.map((c) => {
                  const ed = editing !== null && editing.id === a.id && editing.col === c.id ? editing : null
                  return (
                    <div key={c.id} role="gridcell" data-col={c.id}
                      style={c.id === 'name' ? { ...cellStyle(c), display: 'flex', alignItems: 'center', paddingLeft: 6 + r.depth * INDENT } : cellStyle(c)}>
                      {c.id === 'name' && (r.hasChildren
                        ? (
                          <button type="button" aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${a.name}`} aria-expanded={!r.collapsed}
                            onClick={(e) => { e.stopPropagation(); onToggleCollapsed(a.id) }}
                            onDoubleClick={(e) => e.stopPropagation()}
                            style={{ width: 16, flex: '0 0 16px', padding: 0, border: 'none', background: 'transparent', color: 'var(--c-text-dim)', cursor: 'pointer' }}>
                            {r.collapsed ? '▸' : '▾'}
                          </button>
                        )
                        : <span style={{ width: 16, flex: '0 0 16px' }} />)}
                      {ed
                        ? <EditInput editing={ed} label={c.label} onChange={(value) => setEditing({ ...ed, value, invalid: false })}
                            onDone={(how) => {
                              if (how === 'cancel') { setEditing(null); scroller.current?.focus({ preventScroll: true }); return true }
                              const closed = commit(ed)
                              if (closed) { setEditing(null); if (how === 'enter') scroller.current?.focus({ preventScroll: true }) }
                              else if (how === 'blur') setEditing(null)
                              else setEditing({ ...ed, invalid: true })
                              return closed || how === 'blur'
                            }} />
                        : <CellText col={c.id} a={a} wbs={r.wbs} s={s} />}
                    </div>
                  )
                })}
              </div>
            )
          })}
        </div>
      </div>

    </div>
  )
}

function CellText({ col, a, wbs, s }: {
  col: ColumnId; a: ActivityRow; wbs: string
  s: { earlyStart: string; earlyFinish: string; totalFloat: number } | undefined
}) {
  let text: string
  switch (col) {
    case 'wbs': text = wbs; break
    case 'name': text = a.name; break
    case 'duration': text = isSummary(a) ? '—' : `${a.original_duration}d`; break
    case 'start': text = s?.earlyStart ?? '—'; break
    case 'finish': text = s?.earlyFinish ?? '—'; break
    case 'float': text = s ? `${s.totalFloat}d` : '—'; break
    case 'percent': text = `${a.percent_complete}%`; break
  }
  if (col === 'name') return <span style={{ overflow: 'hidden', textOverflow: 'ellipsis' }}>{text}</span>
  return <>{text}</>
}

/** One inline editor. Enter commits, Escape cancels, leaving the field commits a valid value. */
function EditInput({ editing, label, onChange, onDone }: {
  editing: Editing; label: string
  onChange: (value: string) => void
  /** Returns true when the editor closed. */
  onDone: (how: 'enter' | 'blur' | 'cancel') => boolean
}) {
  const ref = useRef<HTMLInputElement>(null)
  const closed = useRef(false)
  useEffect(() => { ref.current?.focus(); if (editing.col !== 'start') ref.current?.select() }, [editing.col])
  const finish = (how: 'enter' | 'blur' | 'cancel') => {
    if (closed.current) return
    // Closed BEFORE onDone: its refocus blurs this input re-entrantly.
    closed.current = true
    if (!onDone(how)) closed.current = false
  }
  return (
    <input ref={ref} aria-label={label} aria-invalid={editing.invalid}
      type={editing.col === 'start' ? 'date' : 'text'} inputMode={editing.col === 'duration' ? 'numeric' : undefined}
      value={editing.value}
      onChange={(e) => onChange(e.target.value)}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); finish('enter') }
        else if (e.key === 'Escape') { e.preventDefault(); finish('cancel') }
      }}
      onBlur={() => finish('blur')}
      onClick={(e) => e.stopPropagation()} onDoubleClick={(e) => e.stopPropagation()}
      style={{
        width: '100%', minWidth: 0, height: ROW_HEIGHT - 6, fontSize: 13, padding: '0 4px', boxSizing: 'border-box',
        border: `1px solid ${editing.invalid ? 'var(--c-red)' : 'var(--c-amber)'}`, borderRadius: 4,
        background: 'var(--c-input-bg)', color: 'var(--c-text)',
      }} />
  )
}
