import { describe, it, expect } from 'vitest'
import { applyBarDrag, fitSegments, splitSegmentsAt, moveSegment, segmentsSpan } from './drag'

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
