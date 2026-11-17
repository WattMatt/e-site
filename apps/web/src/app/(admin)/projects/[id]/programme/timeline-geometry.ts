/**
 * Pure geometry for the programme timeline: bar shapes per activity type, orthogonal link
 * paths per link type, hit-testing (end handle, right edge, body), working-day snapping on
 * an activity's calendar, and zoom maths. No React, no DOM: the component draws what these
 * return, and the tests pin them directly.
 *
 * Coordinates are content pixels: x from the timescale origin, y from the top of row 0.
 */
import {
  barX, buildEngineCalendar, DAY_WIDTH, displayFinish, displayStart, ROW_HEIGHT, rowsToProgrammeInput, startOf, xOfDate,
  type ActivityRow, type CalendarDate, type EngineCalendar, type LinkType, type ProgrammeState, type Timescale, type Zoom,
} from '@esite/shared/programme'

type Scale = Pick<Timescale, 'origin' | 'dayWidth'>

export const ZOOMS: readonly Zoom[] = ['day', 'week', 'month', 'quarter', 'year']
/** Vertical inset of a task bar inside its row; the baseline line sits under it. */
export const BAR_TOP = 5
export const BAR_HEIGHT = 14
export const BASELINE_TOP = 22
export const BASELINE_HEIGHT = 3
export const SUMMARY_HEIGHT = 6
export const MILESTONE_HALF = 7
/** The link handle: a circle this far right of the bar end. */
export const HANDLE_OFFSET = 8
export const HANDLE_RADIUS = 5
/** Width of the resize zone inside a task bar's right edge. */
export const EDGE_ZONE = 6
const LINK_STUB = 8

export type BarKind = 'task' | 'milestone' | 'summary'

export function barKind(type: ActivityRow['type']): BarKind {
  if (type === 'start_milestone' || type === 'finish_milestone') return 'milestone'
  if (type === 'summary' || type === 'module_summary') return 'summary'
  return 'task'
}

export interface BarGeometry {
  id: string
  kind: BarKind
  /** Row index in the outline. */
  index: number
  /** Left and width in px; a milestone has width 0 and `x` is its centre. */
  x: number
  width: number
  /** Top and height of the drawn shape. */
  y: number
  height: number
  /** Row centre: where links attach. */
  midY: number
  /** x where the float tail ends (end of `lateFinish`'s day), or null without positive float. */
  floatTo: number | null
}

export function barGeometry(
  scale: Scale, id: string, type: ActivityRow['type'], index: number,
  dates: { earlyStart: CalendarDate; earlyFinish: CalendarDate; lateFinish?: CalendarDate | null },
): BarGeometry {
  const kind = barKind(type)
  const top = index * ROW_HEIGHT
  const midY = top + ROW_HEIGHT / 2
  if (kind === 'milestone') {
    // The moment by type: a finish milestone is the END of its display day (after its
    // predecessor's last day), a start milestone the start of its day.
    const x = type === 'finish_milestone'
      ? xOfDate(scale, dates.earlyFinish) + scale.dayWidth
      : barX(scale, dates.earlyStart, dates.earlyStart, true).x
    return { id, kind, index, x, width: 0, y: midY - MILESTONE_HALF, height: MILESTONE_HALF * 2, midY, floatTo: null }
  }
  const { x, width } = barX(scale, dates.earlyStart, dates.earlyFinish)
  const end = x + width
  let floatTo: number | null = null
  if (kind === 'task' && dates.lateFinish && dates.lateFinish > dates.earlyFinish) {
    floatTo = xOfDate(scale, dates.lateFinish) + scale.dayWidth
    if (floatTo <= end) floatTo = null
  }
  if (kind === 'summary') return { id, kind, index, x, width, y: top + BAR_TOP, height: SUMMARY_HEIGHT, midY, floatTo: null }
  return { id, kind, index, x, width, y: top + BAR_TOP, height: BAR_HEIGHT, midY, floatTo }
}

/** Where a link leaves or meets a bar: its start or its end, at the row centre. */
export function barPoint(b: BarGeometry, side: 'start' | 'end'): { x: number; y: number } {
  if (b.kind === 'milestone') return { x: side === 'start' ? b.x - MILESTONE_HALF : b.x + MILESTONE_HALF, y: b.midY }
  return { x: side === 'start' ? b.x : b.x + b.width, y: b.midY }
}

const SIDES: Record<LinkType, ['start' | 'end', 'start' | 'end']> = {
  FS: ['end', 'start'], SS: ['start', 'start'], FF: ['end', 'end'], SF: ['start', 'end'],
}

/**
 * An orthogonal path for a link: out of the predecessor's side, into the successor's side.
 * The first point is on the predecessor, the last on the successor (the arrow tip).
 */
export function linkPoints(type: LinkType, pred: BarGeometry, succ: BarGeometry): Array<{ x: number; y: number }> {
  const [ps, ss] = SIDES[type]
  const p = barPoint(pred, ps)
  // Into a milestone on another row, drop vertically onto the diamond's tip when its centre
  // lies on the side the link travels towards: no backwards hook into a point.
  if (succ.kind === 'milestone' && succ.midY !== p.y && (ss === 'start' ? succ.x >= p.x : succ.x <= p.x)) {
    const tipY = succ.midY + (succ.midY > p.y ? -MILESTONE_HALF : MILESTONE_HALF)
    return succ.x === p.x ? [p, { x: succ.x, y: tipY }] : [p, { x: succ.x, y: p.y }, { x: succ.x, y: tipY }]
  }
  const q = barPoint(succ, ss)
  const outX = p.x + (ps === 'end' ? LINK_STUB : -LINK_STUB)
  const inX = q.x + (ss === 'start' ? -LINK_STUB : LINK_STUB)
  // Straight down then across when the stub already sits on the right side of the target.
  const fits = ss === 'start' ? outX <= inX : outX >= inX
  if (fits && p.y !== q.y) return [p, { x: outX, y: p.y }, { x: outX, y: q.y }, q]
  // Otherwise turn in the gap between the two rows.
  const gapY = q.y === p.y ? p.y + ROW_HEIGHT / 2 : p.y + Math.sign(q.y - p.y) * (ROW_HEIGHT / 2)
  return [p, { x: outX, y: p.y }, { x: outX, y: gapY }, { x: inX, y: gapY }, { x: inX, y: q.y }, q]
}

export function pathD(points: Array<{ x: number; y: number }>): string {
  return points.map((pt, i) => `${i === 0 ? 'M' : 'L'}${round(pt.x)} ${round(pt.y)}`).join(' ')
}
const round = (n: number) => Math.round(n * 100) / 100

/** True when (x, y) is on the drawn link handle of a task or milestone (radius HANDLE_RADIUS). */
export function onDrawnHandle(b: BarGeometry, x: number, y: number): boolean {
  if (b.kind === 'summary') return false
  const end = b.kind === 'milestone' ? b.x + MILESTONE_HALF : b.x + b.width
  return Math.hypot(x - (end + HANDLE_OFFSET), y - b.midY) <= HANDLE_RADIUS
}

export type Hit = { part: 'handle' | 'edge' | 'body'; id: string }

/**
 * What is under (x, y): a bar's link handle, a task's right edge, or a bar's body; null
 * otherwise. Without `editing`, only bodies are hit (no handle or edge exists read-only).
 * A summary is only ever a body (it is not dragged and does not start links).
 */
export function hitTest(bars: readonly BarGeometry[], x: number, y: number, editing: boolean): Hit | null {
  const index = Math.floor(y / ROW_HEIGHT)
  const b = bars.find((g) => g.index === index)
  if (!b) return null
  if (b.kind === 'milestone') {
    if (editing && Math.hypot(x - (b.x + MILESTONE_HALF + HANDLE_OFFSET), y - b.midY) <= HANDLE_RADIUS + 2) return { part: 'handle', id: b.id }
    if (Math.abs(x - b.x) + Math.abs(y - b.midY) <= MILESTONE_HALF + 1) return { part: 'body', id: b.id }
    return null
  }
  const end = b.x + b.width
  if (editing && b.kind === 'task' && Math.hypot(x - (end + HANDLE_OFFSET), y - b.midY) <= HANDLE_RADIUS + 2) return { part: 'handle', id: b.id }
  // Task and summary bars answer over the full bar band (a summary is drawn thinner).
  const top = b.index * ROW_HEIGHT + BAR_TOP
  if (y < top - 2 || y > top + BAR_HEIGHT + 2) return null
  if (x < b.x || x > end) return null
  if (editing && b.kind === 'task' && x >= end - EDGE_ZONE && b.width >= EDGE_ZONE * 2) return { part: 'edge', id: b.id }
  return { part: 'body', id: b.id }
}

// ── calendars and snapping ──────────────────────────────────────────────────

export interface TimelineCalendars {
  /** The engine calendar an activity schedules on (its own, else the programme default). */
  forActivity(calendarId: string | null): EngineCalendar | null
}

/** Engine calendars built exactly as the engine builds them for this state. */
export function timelineCalendars(state: Pick<ProgrammeState, 'programme' | 'calendars' | 'exceptions'>): TimelineCalendars {
  const input = rowsToProgrammeInput({ ...state, activities: [], dependencies: [] })
  const built = new Map<string, EngineCalendar>()
  for (const spec of input.calendars) {
    try { built.set(spec.id, buildEngineCalendar(spec)) } catch { /* a calendar the engine refuses snaps nothing */ }
  }
  return { forActivity: (id) => built.get(id ?? input.defaultCalendarId) ?? built.get(input.defaultCalendarId) ?? null }
}

export const addDays = (d: CalendarDate, n: number): CalendarDate => displayStart(startOf(d) + n)
export const daysFrom = (a: CalendarDate, b: CalendarDate): number => startOf(b) - startOf(a)

/** The first working day on or after `d` (`d` itself without a calendar). */
export function snapForward(cal: EngineCalendar | null, d: CalendarDate): CalendarDate {
  if (!cal) return d
  let n = startOf(d)
  for (let i = 0; i < 3660 && !cal.isWorkingDay(n); i++) n++
  return displayStart(n)
}

/** Working days in [start, finish], both inclusive; at least 1. */
export function workingDaysInclusive(cal: EngineCalendar | null, start: CalendarDate, finish: CalendarDate): number {
  if (finish < start) return 1
  if (!cal) return daysFrom(start, finish) + 1
  return Math.max(1, Math.round(cal.workBetween(startOf(start), startOf(finish) + 1)))
}

/** The new start for a move of `dx` px: whole days, snapped forward to a working day. */
export function movedStart(scale: Scale, cal: EngineCalendar | null, start: CalendarDate, dx: number): CalendarDate {
  return snapForward(cal, addDays(start, Math.round(dx / scale.dayWidth)))
}

/**
 * The display finish of `duration` working days from `start` on the calendar, as the engine
 * places it (`addWork` to a finish instant, then `displayFinish`); calendar days without one.
 */
export function finishAfter(cal: EngineCalendar | null, start: CalendarDate, duration: number): CalendarDate {
  if (duration <= 0) return start
  if (!cal) return addDays(start, Math.ceil(duration) - 1)
  return displayFinish(cal, cal.addWork(cal.snapStart(startOf(start)), duration, 'finish'))
}

/** The new duration for a right-edge drag of `dx` px: working days from start to the day the edge lands on. */
export function resizedDuration(scale: Scale, cal: EngineCalendar | null, start: CalendarDate, finish: CalendarDate, dx: number): number {
  const newFinish = addDays(finish, Math.round(dx / scale.dayWidth))
  return workingDaysInclusive(cal, start, newFinish)
}

// ── zoom ────────────────────────────────────────────────────────────────────

export function zoomStep(z: Zoom, dir: 'in' | 'out'): Zoom {
  const i = ZOOMS.indexOf(z)
  return ZOOMS[Math.max(0, Math.min(ZOOMS.length - 1, i + (dir === 'in' ? -1 : 1)))]
}

/** The scrollLeft that keeps the date under the cursor (at `offset` px into the viewport) in place across a zoom. */
export function scrollLeftAround(scrollLeft: number, offset: number, fromDayWidth: number, toDayWidth: number): number {
  const days = (scrollLeft + offset) / fromDayWidth
  return Math.max(0, days * toDayWidth - offset)
}

/** The closest zoom at which `days` fit in `width` px (the widest bars that still fit; year if nothing does). */
export function fitZoom(days: number, width: number): Zoom {
  if (width <= 0) return 'month'
  return ZOOMS.find((z) => days * DAY_WIDTH[z] <= width) ?? 'year'
}
