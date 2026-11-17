'use client'

/**
 * The programme's timeline: a sticky two-band time header over one SVG that draws only the
 * visible rows, inside a spacer of `rows × ROW_HEIGHT`, so 5,000 activities cost the same as 50.
 *
 * - The vertical scroll is shared with the grid (`scrollTop` in, `onScrollTop` out); the
 *   header is `HEADER_HEIGHT` tall and the pane ends in the same footer height as the grid's,
 *   so the two viewports are equal and their rows line up to the bottom.
 * - Bars: tasks from earlyStart to earlyFinish with % complete as an inner fill and a float
 *   tail to lateFinish; milestones as diamonds; summaries as bracket bars; critical in red;
 *   the active baseline as a thin line under the bar. Links are drawn when either end is
 *   visible; a click opens `LinkDialog`.
 * - With `canEdit`: drag a body to move (one SNET op at the snapped working day), drag the
 *   right edge to resize (`original_duration` in working days), drag from the end handle to
 *   another bar for an FS link. Pointer capture throughout; Escape cancels; the commit is one
 *   `apply` on pointerup. Without it a drag does nothing and a click only selects.
 * - Ids held across a gesture are resolved through the store's `keyIds`, as the grid does.
 */
import {
  useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState,
  type CSSProperties, type PointerEvent as ReactPointerEvent,
} from 'react'
import {
  barX, DAY_WIDTH, HEADER_HEIGHT, outlineRows, ROW_HEIGHT, timescale, visibleRange, xOfDate,
  type ActivityRow, type CalendarDate, type ProgrammeOp, type Zoom,
} from '@esite/shared/programme'
import type { ActiveBaselineView } from '@/lib/programme/view-types'
import type { ProgrammeStoreApi } from './use-programme-store'
import {
  BAR_HEIGHT, BASELINE_HEIGHT, BASELINE_TOP, barGeometry, finishAfter, fitZoom, HANDLE_OFFSET, HANDLE_RADIUS, hitTest,
  linkPoints, MILESTONE_HALF, movedStart, onDrawnHandle, pathD, resizedDuration, scrollLeftAround, timelineCalendars, workingDaysInclusive, ZOOMS, zoomStep,
  type BarGeometry, type Hit,
} from './timeline-geometry'
import { LinkDialog } from './LinkDialog'
import { PANE_FOOTER_HEIGHT } from './pane'

export type GanttTimelineStore = Pick<ProgrammeStoreApi, 'state' | 'schedule' | 'apply' | 'newKey' | 'keyIds'>

export interface GanttTimelineProps {
  store: GanttTimelineStore
  canEdit: boolean
  scrollTop: number
  onScrollTop: (top: number) => void
  collapsed: ReadonlySet<string>
  selected: ReadonlySet<string>
  /** A bar was clicked: select only it, or toggle it (⌘/Ctrl). */
  onSelect: (id: string, mode: 'only' | 'toggle') => void
  activeBaseline: ActiveBaselineView | null
  zoom: Zoom
  onZoom: (zoom: Zoom) => void
  /** Today's date; omitted = the browser's local date (set after mount), null = no today line. */
  today?: CalendarDate | null
}

const OVERSCAN = 10
const DRAG_SLOP = 3
/** Accumulated wheel delta per zoom step (a mouse notch is 100–120), and the least time between steps. */
const WHEEL_STEP = 100
const WHEEL_GAP_MS = 150
const ZOOM_LABEL: Record<Zoom, string> = { day: 'Days', week: 'Weeks', month: 'Months', quarter: 'Quarters', year: 'Years' }
const button: CSSProperties = {
  padding: '4px 10px', borderRadius: 6, border: '1px solid var(--c-border)', background: 'var(--c-panel)',
  color: 'var(--c-text)', fontSize: 12, cursor: 'pointer',
}

function localToday(): CalendarDate {
  const d = new Date()
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}

interface Drag {
  mode: 'move' | 'resize' | 'link' | 'click'
  id: string
  pointerId: number
  x0: number; y0: number
  x: number; y: number
  moved: boolean
  toggle: boolean
}

export function GanttTimeline({
  store, canEdit, scrollTop, onScrollTop, collapsed, selected: selectedRaw, onSelect, activeBaseline, zoom, onZoom, today: todayProp,
}: GanttTimelineProps) {
  const { state, schedule, apply, newKey, keyIds } = store
  const activities = state.activities
  const resolve = useCallback((id: string) => keyIds[id] ?? id, [keyIds])
  const selected = useMemo(() => new Set([...selectedRaw].map(resolve)), [selectedRaw, resolve])

  // ── rows ──
  const byId = useMemo(() => new Map(activities.map((a) => [a.id, a])), [activities])
  const rows = useMemo(
    () => outlineRows(activities, collapsed).flatMap((r) => { const a = byId.get(r.id); return a ? [{ id: r.id, activity: a }] : [] }),
    [activities, collapsed, byId],
  )
  const indexOf = useMemo(() => new Map(rows.map((r, i) => [r.id, i])), [rows])

  const [autoToday, setAutoToday] = useState<CalendarDate | null>(null)
  useEffect(() => { if (todayProp === undefined) setAutoToday(localToday()) }, [todayProp])
  const today = todayProp === undefined ? autoToday : todayProp

  // ── scale ──
  const range = useMemo(() => {
    let lo = state.programme.project_start
    let hi = lo
    const see = (d: string | null | undefined) => { if (!d) return; if (d < lo) lo = d; if (d > hi) hi = d }
    for (const s of schedule.activities.values()) { see(s.earlyStart); see(s.earlyFinish); see(s.lateFinish) }
    see(state.programme.data_date)
    if (activeBaseline) for (const b of Object.values(activeBaseline.activities)) { see(b.early_start); see(b.early_finish) }
    return { lo, hi }
  }, [state.programme.project_start, state.programme.data_date, schedule, activeBaseline])
  const scale = useMemo(() => timescale(range.lo, range.hi, zoom), [range, zoom])
  const calendars = useMemo(
    () => timelineCalendars({ programme: state.programme, calendars: state.calendars, exceptions: state.exceptions }),
    [state.programme, state.calendars, state.exceptions],
  )

  // ── scroll + viewport ──
  const scroller = useRef<HTMLDivElement>(null)
  const spacer = useRef<HTMLDivElement>(null)
  const [viewport, setViewport] = useState({ height: 0, width: 0 })
  const [scrollLeft, setScrollLeft] = useState(0)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el) return
    const measure = () => setViewport({ height: el.clientHeight, width: el.clientWidth })
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
  const { first, last } = visibleRange(scrollTop, viewport.height - HEADER_HEIGHT, rows.length, ROW_HEIGHT, OVERSCAN)

  /** A horizontal position to restore once the new zoom has rendered. */
  const pendingLeft = useRef<number | null>(null)
  useLayoutEffect(() => {
    const el = scroller.current
    if (!el || pendingLeft.current === null) return
    el.scrollLeft = pendingLeft.current
    setScrollLeft(pendingLeft.current)
    pendingLeft.current = null
  }, [scale.dayWidth])
  const zoomTo = useCallback((next: Zoom, left: number | null) => {
    if (next === zoom) return
    pendingLeft.current = left
    onZoom(next)
  }, [zoom, onZoom])

  // ⌘/Ctrl + wheel zooms around the date under the cursor (a native listener: React's is passive).
  // Deltas accumulate, so a trackpad pinch (dozens of small ctrl+wheel events) steps one level
  // per WHEEL_STEP units and at most once per WHEEL_GAP_MS, as one mouse notch does.
  const wheel = useRef({ acc: 0, last: -Infinity })
  useEffect(() => {
    const el = scroller.current
    if (!el) return
    const onWheel = (e: WheelEvent) => {
      if (!(e.metaKey || e.ctrlKey)) { wheel.current.acc = 0; return }
      e.preventDefault()
      const dy = e.deltaY * (e.deltaMode === 1 ? 40 : e.deltaMode === 2 ? 800 : 1)
      if (dy === 0) return
      const w = wheel.current
      if (Math.sign(dy) !== Math.sign(w.acc)) w.acc = 0
      w.acc += dy
      const now = Date.now()
      if (Math.abs(w.acc) < WHEEL_STEP || now - w.last < WHEEL_GAP_MS) return
      const next = zoomStep(zoom, w.acc < 0 ? 'in' : 'out')
      w.acc = 0
      w.last = now
      const offset = e.clientX - el.getBoundingClientRect().left
      zoomTo(next, scrollLeftAround(el.scrollLeft, offset, DAY_WIDTH[zoom], DAY_WIDTH[next]))
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [zoom, zoomTo])

  /** Today stays outside the timescale (a future job would open on empty canvas): its x when it falls on it. */
  const todayRaw = today ? xOfDate(scale, today) : null
  const todayX = todayRaw !== null && todayRaw >= 0 && todayRaw < scale.width ? todayRaw : null
  const scrollToToday = () => {
    const el = scroller.current
    if (!el || todayRaw === null) return
    const end = Math.max(0, scale.width - el.clientWidth)
    // Off the programme: the nearer edge.
    const left = todayX !== null ? Math.min(end, Math.max(0, todayX - el.clientWidth / 2)) : todayRaw < 0 ? 0 : end
    el.scrollLeft = left
    setScrollLeft(left)
  }
  const fit = () => {
    const el = scroller.current
    const next = fitZoom(scale.width / scale.dayWidth, el?.clientWidth ?? 0)
    if (next === zoom) { if (el) { el.scrollLeft = 0; setScrollLeft(0) } return }
    zoomTo(next, 0)
  }

  // ── geometry ──
  const geomAt = useCallback((i: number): BarGeometry | null => {
    const r = rows[i]
    const s = r ? schedule.activities.get(r.id) : undefined
    if (!r || !s) return null
    return barGeometry(scale, r.id, r.activity.type, i, s)
  }, [rows, schedule, scale])
  const bars = useMemo(() => {
    const out: BarGeometry[] = []
    for (let i = first; i < last; i++) { const g = geomAt(i); if (g) out.push(g) }
    return out
  }, [first, last, geomAt])

  // ── drag ──
  const [drag, setDrag] = useState<Drag | null>(null)
  const dragRef = useRef<Drag | null>(null)
  const [hover, setHover] = useState<Hit | null>(null)
  const setDragBoth = (d: Drag | null) => { dragRef.current = d; setDrag(d) }

  const local = (e: { clientX: number; clientY: number }) => {
    const r = spacer.current?.getBoundingClientRect()
    return { x: e.clientX - (r?.left ?? 0), y: e.clientY - (r?.top ?? 0) }
  }

  const dragging = drag !== null
  useEffect(() => {
    if (!dragging) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { e.preventDefault(); setDragBoth(null) } }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [dragging])

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return
    // A press on a link belongs to the link (its click opens the dialog), even where its
    // first stub runs through a bar's link-handle zone.
    // A press on the drawn handle itself still wins (touch has no hover to tell them apart).
    if (e.target instanceof Element && e.target.closest('[data-part="link-hit"]')) {
      const { x, y } = local(e)
      const b = bars.find((g) => g.index === Math.floor(y / ROW_HEIGHT))
      if (!canEdit || !b || !onDrawnHandle(b, x, y)) return
    }
    const { x, y } = local(e)
    const hit = hitTest(bars, x, y, canEdit)
    if (!hit) return
    const a = byId.get(hit.id)
    if (!a) return
    const kind = bars.find((b) => b.id === hit.id)?.kind
    let mode: Drag['mode'] = 'click'
    if (canEdit && kind !== 'summary') mode = hit.part === 'handle' ? 'link' : hit.part === 'edge' ? 'resize' : 'move'
    e.preventDefault()
    e.currentTarget.setPointerCapture?.(e.pointerId)
    setDragBoth({ mode, id: hit.id, pointerId: e.pointerId, x0: x, y0: y, x, y, moved: false, toggle: e.metaKey || e.ctrlKey })
  }
  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const { x, y } = local(e)
    const d = dragRef.current
    if (!d) {
      const h = hitTest(bars, x, y, canEdit)
      if (h?.id !== hover?.id || h?.part !== hover?.part) setHover(h)
      return
    }
    const moved = d.moved || Math.abs(x - d.x0) > DRAG_SLOP || Math.abs(y - d.y0) > DRAG_SLOP
    setDragBoth({ ...d, x, y, moved })
  }
  const endDrag = (e: ReactPointerEvent<HTMLDivElement>, commitIt: boolean) => {
    const d = dragRef.current
    if (!d) return
    e.currentTarget.releasePointerCapture?.(e.pointerId)
    setDragBoth(null)
    if (!commitIt) return
    const { x, y } = local(e)
    const done = { ...d, x, y, moved: d.moved || Math.abs(x - d.x0) > DRAG_SLOP || Math.abs(y - d.y0) > DRAG_SLOP }
    if (!done.moved) { onSelect(resolve(done.id), done.toggle ? 'toggle' : 'only'); return }
    commit(done)
  }

  const commit = (d: Drag) => {
    if (!canEdit || d.mode === 'click') return
    const id = resolve(d.id)
    const a = byId.get(id)
    const s = schedule.activities.get(id)
    if (!a || !s) return
    const cal = calendars.forActivity(a.calendar_id)
    const dx = d.x - d.x0
    let op: ProgrammeOp | null = null
    let label = ''
    if (d.mode === 'move') {
      const start = movedStart(scale, cal, s.earlyStart, dx)
      if (start !== s.earlyStart) {
        op = { op: 'upsert_activity', id, fields: { constraint_type: 'snet', constraint_date: start } }
        label = 'Move'
      }
    } else if (d.mode === 'resize') {
      const duration = resizedDuration(scale, cal, s.earlyStart, s.earlyFinish, dx)
      if (duration !== a.original_duration) {
        op = { op: 'upsert_activity', id, fields: { original_duration: duration } }
        label = 'Change duration'
      }
    } else {
      const target = hitTest(bars, d.x, d.y, false)
      const succ = target ? resolve(target.id) : null
      if (succ && succ !== id) {
        op = { op: 'upsert_dependency', key: newKey(), pred: id, succ, type: 'FS', lag: 0 }
        label = 'Link'
      }
    }
    if (op) apply([op], label)
  }

  // ── link dialog ──
  const [openLink, setOpenLink] = useState<string | null>(null)
  const openDep = openLink === null ? undefined : state.dependencies.find((d) => d.id === resolve(openLink))
  const closeLink = useCallback(() => setOpenLink(null), [])

  // ── render data ──
  const top = first * ROW_HEIGHT
  const bottom = last * ROW_HEIGHT
  const linkEls = useMemo(() => {
    const out: Array<{ id: string; d: string; arrow: string; colour: string; width: number }> = []
    if (last <= first) return out
    for (const dep of state.dependencies) {
      const i = indexOf.get(dep.pred_id)
      const j = indexOf.get(dep.succ_id)
      if (i === undefined || j === undefined) continue
      if (!((i >= first && i < last) || (j >= first && j < last))) continue
      const p = geomAt(i)
      const q = geomAt(j)
      if (!p || !q) continue
      const pts = linkPoints(dep.type, p, q)
      const tip = pts[pts.length - 1]
      const prev = pts[pts.length - 2]
      const arrow = tip.x === prev.x
        ? (() => { const dy = Math.sign(tip.y - prev.y) || 1; return `M${tip.x} ${tip.y} L${tip.x - 4} ${tip.y - dy * 5} L${tip.x + 4} ${tip.y - dy * 5} Z` })()
        : (() => { const dx = Math.sign(tip.x - prev.x) || 1; return `M${tip.x} ${tip.y} L${tip.x - dx * 5} ${tip.y - 4} L${tip.x - dx * 5} ${tip.y + 4} Z` })()
      const driving = schedule.drivingLinkIds.has(dep.id)
      const critical = driving && schedule.activities.get(dep.pred_id)?.isCritical && schedule.activities.get(dep.succ_id)?.isCritical
      out.push({
        id: dep.id, d: pathD(pts), arrow,
        colour: critical ? 'var(--c-red)' : driving ? 'var(--c-text)' : 'var(--c-text-dim)',
        width: driving ? 1.5 : 1,
      })
    }
    return out
  }, [state.dependencies, indexOf, first, last, geomAt, schedule])

  const preview = (() => {
    if (!drag || !drag.moved || drag.mode === 'click') return null
    const i = indexOf.get(resolve(drag.id))
    const g = i === undefined ? null : geomAt(i)
    const a = byId.get(resolve(drag.id))
    const s = schedule.activities.get(resolve(drag.id))
    if (!g || !a || !s) return null
    const dx = drag.x - drag.x0
    if (drag.mode === 'link') {
      return <line data-testid="timeline-link-preview" x1={g.kind === 'milestone' ? g.x + MILESTONE_HALF : g.x + g.width} y1={g.midY}
        x2={drag.x} y2={drag.y} stroke="var(--c-text)" strokeWidth={1.5} strokeDasharray="4 3" pointerEvents="none" />
    }
    // The same working-day maths as the commit and the engine: snap the start forward, then
    // place the working-day span on the activity's calendar.
    const cal = calendars.forActivity(a.calendar_id)
    const outline = (x: number, width: number) => (
      <rect data-testid="timeline-preview" x={x} y={g.index * ROW_HEIGHT + 5} width={width} height={BAR_HEIGHT}
        rx={3} fill="none" stroke="var(--c-text)" strokeWidth={1.5} pointerEvents="none" />
    )
    if (drag.mode === 'move') {
      const start = movedStart(scale, cal, s.earlyStart, dx)
      if (g.kind === 'milestone') {
        const m = barGeometry(scale, g.id, a.type, g.index, { earlyStart: start, earlyFinish: start })
        return outline(m.x - MILESTONE_HALF, MILESTONE_HALF * 2)
      }
      const span = barX(scale, start, finishAfter(cal, start, workingDaysInclusive(cal, s.earlyStart, s.earlyFinish)))
      return outline(span.x, span.width)
    }
    const duration = resizedDuration(scale, cal, s.earlyStart, s.earlyFinish, dx)
    const span = barX(scale, s.earlyStart, finishAfter(cal, s.earlyStart, duration))
    return outline(span.x, span.width)
  })()

  const xMin = viewport.width > 0 ? scrollLeft - 200 : -Infinity
  const xMax = viewport.width > 0 ? scrollLeft + viewport.width + 200 : Infinity
  const inView = (b: { x: number; width: number }) => b.x + b.width >= xMin && b.x <= xMax
  const dataDate = state.programme.data_date
  const cursor = drag
    ? (drag.mode === 'resize' ? 'ew-resize' : drag.mode === 'link' ? 'crosshair' : drag.mode === 'move' ? 'grabbing' : 'default')
    : hover?.part === 'edge' ? 'ew-resize' : hover?.part === 'handle' ? 'crosshair' : hover && canEdit ? 'grab' : 'default'
  const showHandleFor = (id: string) => canEdit && (hover?.id === id || selected.has(id) || (drag?.mode === 'link' && resolve(drag.id) === id))

  return (
    <div data-testid="programme-timeline" style={{ position: 'relative', display: 'flex', flexDirection: 'column', height: '100%', minHeight: 0 }}>
      <div ref={scroller} data-testid="programme-timeline-scroll"
        onScroll={(e) => { onScrollTop(e.currentTarget.scrollTop); setScrollLeft(e.currentTarget.scrollLeft) }}
        style={{ flex: '1 1 auto', minHeight: 0, overflowY: 'auto', overflowX: 'scroll', position: 'relative' }}>
        <div data-testid="programme-timeline-header" style={{
          position: 'sticky', top: 0, zIndex: 2, height: HEADER_HEIGHT, width: scale.width,
          background: 'var(--c-panel)', borderBottom: '1px solid var(--c-border)',
        }}>
          <svg width={scale.width} height={HEADER_HEIGHT} style={{ display: 'block' }} aria-hidden>
            {scale.bands.top.filter(inView).map((b) => (
              <g key={`t${b.x}`}>
                <line x1={b.x} x2={b.x} y1={0} y2={HEADER_HEIGHT / 2} stroke="var(--c-border)" />
                <text x={b.x + 4} y={15} fontSize={11} fill="var(--c-text-dim)">{b.label}</text>
              </g>
            ))}
            <line x1={0} x2={scale.width} y1={HEADER_HEIGHT / 2} y2={HEADER_HEIGHT / 2} stroke="var(--c-border)" />
            {scale.bands.bottom.filter(inView).map((b) => (
              <g key={`b${b.x}`}>
                <line x1={b.x} x2={b.x} y1={HEADER_HEIGHT / 2} y2={HEADER_HEIGHT} stroke="var(--c-border)" />
                {b.width >= 14 && <text x={b.x + 3} y={HEADER_HEIGHT - 7} fontSize={11} fill="var(--c-text-dim)">{b.label}</text>}
              </g>
            ))}
            {todayX !== null && (
              <text x={todayX + 3} y={HEADER_HEIGHT / 2 - 4} fontSize={10} fontWeight={600} fill="var(--c-text)">Today</text>
            )}
          </svg>
        </div>
        <div ref={spacer} data-testid="programme-timeline-spacer"
          style={{ position: 'relative', height: rows.length * ROW_HEIGHT, width: scale.width, cursor, touchAction: 'pan-x pan-y' }}>
          <div data-testid="programme-timeline-body" role="presentation"
            onPointerDown={onPointerDown} onPointerMove={onPointerMove}
            onPointerUp={(e) => endDrag(e, true)} onPointerCancel={(e) => endDrag(e, false)}
            onPointerLeave={() => { if (!dragRef.current) setHover(null) }}
            style={{ position: 'absolute', inset: 0 }}>
            <svg width={scale.width} height={Math.max(0, bottom - top)} aria-label="Timeline" role="img"
              style={{ position: 'absolute', left: 0, top, overflow: 'visible', display: 'block' }}>
              <g transform={`translate(0 ${-top})`}>
                {rows.slice(first, last).map((r, k) => selected.has(r.id) && (
                  <rect key={`sel-${r.id}`} x={0} y={(first + k) * ROW_HEIGHT} width={scale.width} height={ROW_HEIGHT} fill="var(--c-amber-dim)" />
                ))}
                {dataDate && (
                  <line data-testid="timeline-data-date" x1={xOfDate(scale, dataDate)} x2={xOfDate(scale, dataDate)} y1={top} y2={bottom}
                    stroke="var(--c-text-dim)" strokeWidth={1} strokeDasharray="4 4" />
                )}
                {todayX !== null && (
                  <line data-testid="timeline-today" x1={todayX} x2={todayX} y1={top} y2={bottom} stroke="var(--c-text)" strokeWidth={1} />
                )}
                {linkEls.map((l) => (
                  <g key={l.id} data-link-id={l.id}>
                    <path d={l.d} fill="none" stroke={l.colour} strokeWidth={l.width} />
                    <path d={l.arrow} fill={l.colour} />
                    <path data-part="link-hit" d={l.d} fill="none" stroke="transparent" strokeWidth={10}
                      style={{ cursor: 'pointer' }} onClick={() => setOpenLink(l.id)} />
                  </g>
                ))}
                {bars.map((g) => (
                  <Bar key={g.id} g={g} a={byId.get(g.id)!} critical={schedule.activities.get(g.id)?.isCritical === true}
                    baseline={activeBaseline?.activities[g.id] ?? null} scale={scale} handle={showHandleFor(g.id)} draggable={canEdit} />
                ))}
                {preview}
              </g>
            </svg>
          </div>
        </div>
      </div>

      <div data-testid="programme-timeline-footer" style={{
        flex: `0 0 ${PANE_FOOTER_HEIGHT}px`, height: PANE_FOOTER_HEIGHT, boxSizing: 'border-box', display: 'flex', alignItems: 'center',
        gap: 6, padding: '0 8px', borderTop: '1px solid var(--c-border)', whiteSpace: 'nowrap', overflow: 'hidden',
      }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, color: 'var(--c-text-dim)' }}>
          Zoom
          <select aria-label="Zoom" value={zoom} onChange={(e) => {
              const next = e.target.value as Zoom
              const el = scroller.current
              zoomTo(next, el ? scrollLeftAround(el.scrollLeft, el.clientWidth / 2, DAY_WIDTH[zoom], DAY_WIDTH[next]) : null)
            }}
            style={{ ...button, padding: '3px 6px' }}>
            {ZOOMS.map((z) => <option key={z} value={z}>{ZOOM_LABEL[z]}</option>)}
          </select>
        </label>
        <button type="button" style={button} onClick={scrollToToday} disabled={!today}>Scroll to today</button>
        <button type="button" style={button} onClick={fit}>Fit programme</button>
      </div>

      {openDep && (
        <LinkDialog key={openDep.id} dep={openDep} canEdit={canEdit}
          predName={byId.get(openDep.pred_id)?.name ?? '—'} succName={byId.get(openDep.succ_id)?.name ?? '—'}
          onApply={apply} onClose={closeLink} />
      )}
    </div>
  )
}

function Bar({ g, a, critical, baseline, scale, handle, draggable }: {
  g: BarGeometry; a: ActivityRow; critical: boolean
  baseline: { early_start: string | null; early_finish: string | null } | null
  scale: { origin: CalendarDate; dayWidth: number }; handle: boolean
  /** Touch on an editable bar drags it instead of scrolling the pane. */
  draggable: boolean
}) {
  const colour = g.kind === 'summary' ? 'var(--c-text)' : critical ? 'var(--c-red)' : 'var(--c-amber)'
  const rowTop = g.index * ROW_HEIGHT
  let base: { x: number; width: number } | null = null
  if (baseline?.early_start && baseline.early_finish) {
    const x = xOfDate(scale, baseline.early_start)
    base = { x, width: Math.max(2, xOfDate(scale, baseline.early_finish) + scale.dayWidth - x) }
  }
  const end = g.kind === 'milestone' ? g.x + MILESTONE_HALF : g.x + g.width
  return (
    <g data-bar-id={g.id} data-critical={critical} style={draggable && g.kind !== 'summary' ? { touchAction: 'none' } : undefined}>
      <title>{a.name}</title>
      {base && <rect data-part="baseline" x={base.x} y={rowTop + BASELINE_TOP} width={base.width} height={BASELINE_HEIGHT} fill="var(--c-text-dim)" />}
      {g.floatTo !== null && (
        <line data-part="float" x1={g.x + g.width} x2={g.floatTo} y1={g.midY} y2={g.midY} stroke="var(--c-text-dim)" strokeWidth={1.5} />
      )}
      {g.kind === 'task' && (
        <>
          <rect data-part="bar" x={g.x} y={g.y} width={g.width} height={g.height} rx={3} fill={colour} fillOpacity={0.45} stroke={colour} />
          {a.percent_complete > 0 && (
            <rect data-part="progress" x={g.x} y={g.y} width={(g.width * Math.min(100, a.percent_complete)) / 100} height={g.height} rx={3} fill={colour} />
          )}
        </>
      )}
      {g.kind === 'milestone' && (
        <path data-part="milestone" fill={colour}
          d={`M${g.x} ${g.midY - MILESTONE_HALF} L${g.x + MILESTONE_HALF} ${g.midY} L${g.x} ${g.midY + MILESTONE_HALF} L${g.x - MILESTONE_HALF} ${g.midY} Z`} />
      )}
      {g.kind === 'summary' && (
        <path data-part="summary" fill={colour}
          d={`M${g.x} ${g.y} H${g.x + g.width} V${g.y + g.height + 4} L${g.x + g.width - 5} ${g.y + g.height} H${g.x + 5} L${g.x} ${g.y + g.height + 4} Z`} />
      )}
      {handle && g.kind !== 'summary' && (
        <circle data-part="handle" cx={end + HANDLE_OFFSET} cy={g.midY} r={HANDLE_RADIUS}
          fill="var(--c-panel)" stroke="var(--c-text-dim)" strokeWidth={1.5} />
      )}
    </g>
  )
}
