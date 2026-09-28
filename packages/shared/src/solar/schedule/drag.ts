/**
 * Bar drag and split-bar maths (spec §14.2: "snaps to days; one undo step per
 * drag"; "Split bar — segments persisted; roll-up duration = Σ segments").
 * A one-day task (start = end) is legal and reachable by dragging; WM's rules
 * made it impossible (as-is/06 B.3.7).
 */
import { addCalendarDays, daysBetween, type CalendarDate } from './dates'
import { endForDuration, isWorkingDate, shiftDate, spanDays, type WorkCalendar } from './calendar'
import type { ScheduleSegment } from './rows'

export type BarDragMode = 'move' | 'start' | 'end'
export interface Span { start: CalendarDate; end: CalendarDate }

/** Snap to a working day, searching in the direction of the drag. */
function snapWorking(cal: WorkCalendar, d: CalendarDate, dir: 1 | -1): CalendarDate {
  let c = d
  for (let i = 0; i < 400 && !isWorkingDate(cal, c); i++) c = addCalendarDays(c, dir)
  return c
}

/**
 * `deltaDays` is in calendar days (the pointer's travel). In working mode a
 * MOVE keeps the task's working-day duration: the start snaps to a working day
 * in the drag direction and the end is recomputed from it, so a Mon–Fri task
 * dragged +1 becomes Tue–Mon, not Tue–Sat (4 working days).
 */
export function applyBarDrag(span: Span, mode: BarDragMode, deltaDays: number, cal?: WorkCalendar): Span {
  if (mode === 'move') {
    if (cal?.mode === 'working' && deltaDays !== 0) {
      const start = snapWorking(cal, addCalendarDays(span.start, deltaDays), deltaDays > 0 ? 1 : -1)
      if (span.start === span.end) return { start, end: start }
      const days = spanDays(cal, span.start, span.end)
      return days >= 1 ? { start, end: endForDuration(cal, start, days) } : { start, end: addCalendarDays(span.end, daysBetween(span.start, start)) }
    }
    return { start: addCalendarDays(span.start, deltaDays), end: addCalendarDays(span.end, deltaDays) }
  }
  if (mode === 'start') {
    const s = addCalendarDays(span.start, deltaDays)
    return { start: s > span.end ? span.end : s, end: span.end }
  }
  const e = addCalendarDays(span.end, deltaDays)
  return { start: span.start, end: e < span.start ? span.start : e }
}

export function segmentsSpan(segments: readonly ScheduleSegment[]): Span {
  return { start: segments[0].start, end: segments[segments.length - 1].end }
}

/** Working-mode move of a split task: every segment moves `n` working days and keeps its working length. */
export function shiftSegmentsWorking(cal: WorkCalendar, segments: readonly ScheduleSegment[], n: number): ScheduleSegment[] {
  return segments.map((s) => {
    const start = shiftDate(cal, snapWorking(cal, s.start, 1), n)
    const days = spanDays(cal, s.start, s.end)
    return { start, end: days >= 1 ? endForDuration(cal, start, days) : start }
  })
}

/** Keep segments consistent when the whole task is moved or resized. Fewer than two → no split. */
export function fitSegments(segments: readonly ScheduleSegment[], oldSpan: Span, newSpan: Span): ScheduleSegment[] {
  if (segments.length < 2) return []
  const ds = daysBetween(oldSpan.start, newSpan.start)
  const de = daysBetween(oldSpan.end, newSpan.end)
  if (ds === de) return segments.map((s) => ({ start: addCalendarDays(s.start, ds), end: addCalendarDays(s.end, ds) }))
  const kept = segments
    .filter((s) => s.end >= newSpan.start && s.start <= newSpan.end)
    .map((s) => ({ start: s.start < newSpan.start ? newSpan.start : s.start, end: s.end > newSpan.end ? newSpan.end : s.end }))
  if (kept.length < 2) return []
  kept[0] = { start: newSpan.start, end: kept[0].end }
  kept[kept.length - 1] = { start: kept[kept.length - 1].start, end: newSpan.end }
  return kept
}

/** Split the segment containing `at` (at must be after that segment's first day). null = nothing to split. */
export function splitSegmentsAt(span: Span, segments: readonly ScheduleSegment[], at: CalendarDate): ScheduleSegment[] | null {
  const segs = segments.length >= 2 ? [...segments] : [{ start: span.start, end: span.end }]
  const i = segs.findIndex((s) => s.start < at && at <= s.end)
  if (i === -1) return null
  const s = segs[i]
  segs.splice(i, 1, { start: s.start, end: addCalendarDays(at, -1) }, { start: at, end: s.end })
  return segs
}

/** Move one segment by `delta` days; null when it would overlap a neighbour. */
export function moveSegment(segments: readonly ScheduleSegment[], index: number, delta: number): ScheduleSegment[] | null {
  const moved = segments.map((s, i) => (i === index
    ? { start: addCalendarDays(s.start, delta), end: addCalendarDays(s.end, delta) }
    : s))
  const sorted = [...moved].sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0))
  for (let i = 1; i < sorted.length; i++) if (sorted[i].start <= sorted[i - 1].end) return null
  return sorted
}
