/**
 * Bar drag and split-bar maths (spec §14.2: "snaps to days; one undo step per
 * drag"; "Split bar — segments persisted; roll-up duration = Σ segments").
 * A one-day task (start = end) is legal and reachable by dragging; WM's rules
 * made it impossible (as-is/06 B.3.7).
 */
import { addCalendarDays, daysBetween, type CalendarDate } from './dates'
import type { ScheduleSegment } from './rows'

export type BarDragMode = 'move' | 'start' | 'end'
export interface Span { start: CalendarDate; end: CalendarDate }

export function applyBarDrag(span: Span, mode: BarDragMode, deltaDays: number): Span {
  if (mode === 'move') return { start: addCalendarDays(span.start, deltaDays), end: addCalendarDays(span.end, deltaDays) }
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
