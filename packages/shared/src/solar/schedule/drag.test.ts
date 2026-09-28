import { describe, it, expect } from 'vitest'
import { applyBarDrag, fitSegments, splitSegmentsAt, moveSegment, segmentsSpan, shiftSegmentsWorking } from './drag'
import { makeWorkCalendar, saHolidays, spanDays } from './calendar'

describe('applyBarDrag', () => {
  const span = { start: '2026-10-05', end: '2026-10-07' }
  it('move shifts both ends', () => {
    expect(applyBarDrag(span, 'move', 3)).toEqual({ start: '2026-10-08', end: '2026-10-10' })
  })
  it('a resize can shrink a task to ONE day (WM could not)', () => {
    expect(applyBarDrag(span, 'end', -2)).toEqual({ start: '2026-10-05', end: '2026-10-05' })
    expect(applyBarDrag(span, 'start', 2)).toEqual({ start: '2026-10-07', end: '2026-10-07' })
  })
  it('a resize never inverts the task', () => {
    expect(applyBarDrag(span, 'end', -9)).toEqual({ start: '2026-10-05', end: '2026-10-05' })
    expect(applyBarDrag(span, 'start', 9)).toEqual({ start: '2026-10-07', end: '2026-10-07' })
  })
})

describe('segments', () => {
  const segs = [{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-08', end: '2026-10-10' }]
  it('split at a date inside a segment makes two contiguous segments', () => {
    expect(splitSegmentsAt({ start: '2026-10-01', end: '2026-10-05' }, [], '2026-10-03'))
      .toEqual([{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-03', end: '2026-10-05' }])
    expect(splitSegmentsAt({ start: '2026-10-01', end: '2026-10-05' }, [], '2026-10-01')).toBeNull()
  })
  it('moving a whole split task shifts every segment', () => {
    expect(fitSegments(segs, { start: '2026-10-01', end: '2026-10-10' }, { start: '2026-10-03', end: '2026-10-12' }))
      .toEqual([{ start: '2026-10-03', end: '2026-10-05' }, { start: '2026-10-10', end: '2026-10-12' }])
  })
  it('resizing clamps the outer segments; fewer than two left means no split', () => {
    expect(fitSegments(segs, { start: '2026-10-01', end: '2026-10-10' }, { start: '2026-10-02', end: '2026-10-09' }))
      .toEqual([{ start: '2026-10-02', end: '2026-10-03' }, { start: '2026-10-08', end: '2026-10-09' }])
    expect(fitSegments(segs, { start: '2026-10-01', end: '2026-10-10' }, { start: '2026-10-01', end: '2026-10-04' })).toEqual([])
  })
  it('moving one segment refuses an overlap and reports the new span', () => {
    expect(moveSegment(segs, 1, -1)).toEqual([{ start: '2026-10-01', end: '2026-10-03' }, { start: '2026-10-07', end: '2026-10-09' }])
    expect(moveSegment(segs, 1, -5)).toBeNull()
    expect(segmentsSpan(segs)).toEqual({ start: '2026-10-01', end: '2026-10-10' })
  })
})

describe('applyBarDrag — working mode keeps the working-day duration', () => {
  const wcal = makeWorkCalendar('working', saHolidays())
  const ccal = makeWorkCalendar('calendar')
  const monFri = { start: '2026-10-05', end: '2026-10-09' } // Mon–Fri, 5 working days
  it('dragging a Mon–Fri task +1 lands Tue–Mon, still 5 working days', () => {
    const r = applyBarDrag(monFri, 'move', 1, wcal)
    expect(r).toEqual({ start: '2026-10-06', end: '2026-10-12' })
    expect(spanDays(wcal, r.start, r.end)).toBe(5)
  })
  it('a start that lands on a weekend snaps to a working day in the drag direction', () => {
    expect(applyBarDrag(monFri, 'move', 5, wcal)).toEqual({ start: '2026-10-12', end: '2026-10-16' }) // Sat → Mon
    expect(applyBarDrag(monFri, 'move', -1, wcal)).toEqual({ start: '2026-10-02', end: '2026-10-08' }) // Sun → Fri
  })
  it('skips a public holiday (Heritage Day, Thu 24 Sep 2026)', () => {
    const r = applyBarDrag({ start: '2026-09-14', end: '2026-09-18' }, 'move', 7, wcal)
    expect(r).toEqual({ start: '2026-09-21', end: '2026-09-28' })
  })
  it('calendar mode (and no calendar) still shifts by calendar days', () => {
    expect(applyBarDrag(monFri, 'move', 1, ccal)).toEqual({ start: '2026-10-06', end: '2026-10-10' })
    expect(applyBarDrag(monFri, 'move', 1)).toEqual({ start: '2026-10-06', end: '2026-10-10' })
  })
  it('a milestone stays one date', () => {
    expect(applyBarDrag({ start: '2026-10-09', end: '2026-10-09' }, 'move', 1, wcal)).toEqual({ start: '2026-10-12', end: '2026-10-12' })
  })
  it('segments move by the same number of working days and keep their working lengths', () => {
    const segs = [{ start: '2026-10-05', end: '2026-10-06' }, { start: '2026-10-08', end: '2026-10-09' }]
    expect(shiftSegmentsWorking(wcal, segs, 1)).toEqual([{ start: '2026-10-06', end: '2026-10-07' }, { start: '2026-10-09', end: '2026-10-12' }])
  })
})
