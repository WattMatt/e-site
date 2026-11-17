import { describe, expect, it } from 'vitest'
import { DAY_WIDTH, ROW_HEIGHT, timescale, type ProgrammeState } from '@esite/shared/programme'
import { calendarRow, programmeRow } from '@/lib/programme/test-fixtures'
import {
  BAR_HEIGHT, barGeometry, EDGE_ZONE, fitZoom, HANDLE_OFFSET, hitTest, linkPoints, MILESTONE_HALF, movedStart,
  resizedDuration, scrollLeftAround, snapForward, timelineCalendars, workingDaysInclusive, zoomStep,
} from './timeline-geometry'

// Day zoom: 36 px a day; the origin is 7 days before 2026-03-02, so 2026-03-02 is at x = 252.
const scale = timescale('2026-03-02', '2026-04-30', 'day')
const X0 = 7 * 36

/** Mon–Fri calendar with Monday 2026-03-09 a public holiday. */
function cals() {
  return timelineCalendars({
    programme: programmeRow(),
    calendars: [calendarRow('SITE')],
    exceptions: [{ id: 'E1', calendar_id: 'SITE', day: '2026-03-09', kind: 'non_work', label: 'Holiday' }],
  } as unknown as ProgrammeState)
}

describe('barGeometry', () => {
  it('a task spans earlyStart to the end of earlyFinish, inside its row, with a float tail to lateFinish', () => {
    const b = barGeometry(scale, 'A', 'task', 2, { earlyStart: '2026-03-02', earlyFinish: '2026-03-04', lateFinish: '2026-03-06' })
    expect(b).toMatchObject({ kind: 'task', x: X0, width: 3 * 36, midY: 2 * ROW_HEIGHT + ROW_HEIGHT / 2, height: BAR_HEIGHT })
    expect(b.y).toBeGreaterThanOrEqual(2 * ROW_HEIGHT)
    expect(b.y + b.height).toBeLessThanOrEqual(3 * ROW_HEIGHT)
    expect(b.floatTo).toBe(X0 + 5 * 36)
  })

  it('no float tail when lateFinish is earlyFinish', () => {
    expect(barGeometry(scale, 'A', 'task', 0, { earlyStart: '2026-03-02', earlyFinish: '2026-03-04', lateFinish: '2026-03-04' }).floatTo).toBeNull()
  })

  it('a milestone is a diamond centred on its date; a summary is a thinner bracket bar; level of effort draws as a task', () => {
    const m = barGeometry(scale, 'M', 'finish_milestone', 1, { earlyStart: '2026-03-05', earlyFinish: '2026-03-05' })
    expect(m).toMatchObject({ kind: 'milestone', x: X0 + 3 * 36, width: 0, height: MILESTONE_HALF * 2 })
    const s = barGeometry(scale, 'S', 'module_summary', 0, { earlyStart: '2026-03-02', earlyFinish: '2026-03-03' })
    expect(s.kind).toBe('summary')
    expect(s.height).toBeLessThan(BAR_HEIGHT)
    expect(s.floatTo).toBeNull()
    expect(barGeometry(scale, 'L', 'level_of_effort', 0, { earlyStart: '2026-03-02', earlyFinish: '2026-03-02' }).kind).toBe('task')
  })
})

describe('linkPoints', () => {
  const pred = barGeometry(scale, 'P', 'task', 0, { earlyStart: '2026-03-02', earlyFinish: '2026-03-03' }) // x 252..324
  const succ = barGeometry(scale, 'S', 'task', 2, { earlyStart: '2026-03-06', earlyFinish: '2026-03-09' }) // x 396..540
  const ends = (pts: Array<{ x: number; y: number }>) => [pts[0], pts.at(-1)]

  it.each([
    ['FS', 324, 396],
    ['SS', 252, 396],
    ['FF', 324, 540],
    ['SF', 252, 540],
  ] as const)('%s leaves the predecessor and meets the successor on the right sides', (type, fromX, toX) => {
    const pts = linkPoints(type, pred, succ)
    expect(ends(pts)).toEqual([{ x: fromX, y: pred.midY }, { x: toX, y: succ.midY }])
  })

  it('every segment is horizontal or vertical', () => {
    for (const type of ['FS', 'SS', 'FF', 'SF'] as const) {
      for (const [a, b] of [[pred, succ], [succ, pred]]) {
        const pts = linkPoints(type, a, b)
        for (let i = 1; i < pts.length; i++) {
          expect(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y).toBe(true)
        }
      }
    }
  })

  it('an FS to a successor that starts before the predecessor ends routes through the gap between the rows', () => {
    const pts = linkPoints('FS', succ, pred)
    expect(pts.length).toBe(6)
    expect(pts[2].y).toBe(succ.midY - ROW_HEIGHT / 2)
  })
})

describe('hitTest', () => {
  const task = barGeometry(scale, 'T', 'task', 0, { earlyStart: '2026-03-02', earlyFinish: '2026-03-04' }) // 252..360
  const ms = barGeometry(scale, 'M', 'start_milestone', 1, { earlyStart: '2026-03-03', earlyFinish: '2026-03-03' })
  const sum = barGeometry(scale, 'S', 'summary', 2, { earlyStart: '2026-03-02', earlyFinish: '2026-03-04' })
  const bars = [task, ms, sum]
  const mid = task.midY

  it('the end handle, then the right edge, then the body', () => {
    expect(hitTest(bars, 360 + HANDLE_OFFSET, mid, true)).toEqual({ part: 'handle', id: 'T' })
    expect(hitTest(bars, 360 - EDGE_ZONE / 2, mid, true)).toEqual({ part: 'edge', id: 'T' })
    expect(hitTest(bars, 300, mid, true)).toEqual({ part: 'body', id: 'T' })
    expect(hitTest(bars, 200, mid, true)).toBeNull()
    expect(hitTest(bars, 300, mid, false)).toEqual({ part: 'body', id: 'T' })
  })

  it('read-only: no handle and no edge exist', () => {
    expect(hitTest(bars, 360 + HANDLE_OFFSET, mid, false)).toBeNull()
    expect(hitTest(bars, 360 - EDGE_ZONE / 2, mid, false)).toEqual({ part: 'body', id: 'T' })
  })

  it('a milestone has a body and a handle but no edge; a summary is only a body', () => {
    expect(hitTest(bars, ms.x, ms.midY, true)).toEqual({ part: 'body', id: 'M' })
    expect(hitTest(bars, ms.x + MILESTONE_HALF + HANDLE_OFFSET, ms.midY, true)).toEqual({ part: 'handle', id: 'M' })
    expect(hitTest(bars, sum.x + sum.width - 1, sum.y + 1, true)).toEqual({ part: 'body', id: 'S' })
    expect(hitTest(bars, sum.x + sum.width + HANDLE_OFFSET, sum.midY, true)).toBeNull()
  })
})

describe('snapping on the activity calendar', () => {
  const cal = cals().forActivity(null)

  it('a working day stays; a weekend and the holiday after it snap forward to Tuesday', () => {
    expect(snapForward(cal, '2026-03-05')).toBe('2026-03-05')
    expect(snapForward(cal, '2026-03-07')).toBe('2026-03-10')
    expect(snapForward(cal, '2026-03-08')).toBe('2026-03-10')
    expect(snapForward(cal, '2026-03-09')).toBe('2026-03-10')
  })

  it('a move is whole days from the drag, then snapped', () => {
    expect(movedStart(scale, cal, '2026-03-02', 3 * 36 + 10)).toBe('2026-03-05')
    expect(movedStart(scale, cal, '2026-03-02', 5 * 36)).toBe('2026-03-10')
  })

  it('a resize counts working days from the start to the day the edge lands on, at least 1', () => {
    // Mon 2 → Tue 10 crosses a weekend and the Monday holiday: 2,3,4,5,6,10 = 6 working days.
    expect(resizedDuration(scale, cal, '2026-03-02', '2026-03-03', 7 * 36)).toBe(6)
    expect(workingDaysInclusive(cal, '2026-03-02', '2026-03-02')).toBe(1)
    expect(resizedDuration(scale, cal, '2026-03-02', '2026-03-03', -10 * 36)).toBe(1)
  })

  it('an activity on its own calendar snaps on that one', () => {
    const c = timelineCalendars({
      programme: programmeRow(), exceptions: [],
      calendars: [calendarRow('SITE'), calendarRow('SEVEN', { work_weekdays: [1, 2, 3, 4, 5, 6, 7] })],
    } as unknown as ProgrammeState)
    expect(snapForward(c.forActivity('SEVEN'), '2026-03-07')).toBe('2026-03-07')
    expect(snapForward(c.forActivity(null), '2026-03-07')).toBe('2026-03-09')
  })
})

describe('zoom', () => {
  it('steps in and out and stops at the ends', () => {
    expect(zoomStep('week', 'in')).toBe('day')
    expect(zoomStep('day', 'in')).toBe('day')
    expect(zoomStep('quarter', 'out')).toBe('year')
    expect(zoomStep('year', 'out')).toBe('year')
  })

  it('keeps the date under the cursor in place', () => {
    // 100 days in at week zoom, cursor 300 px into the viewport.
    const left = 100 * DAY_WIDTH.week - 300
    const next = scrollLeftAround(left, 300, DAY_WIDTH.week, DAY_WIDTH.day)
    expect((next + 300) / DAY_WIDTH.day).toBeCloseTo(100)
  })

  it('fit picks the widest zoom whose programme fits the width', () => {
    expect(fitZoom(20, 1000)).toBe('day')
    expect(fitZoom(200, 1000)).toBe('month')
    expect(fitZoom(100000, 1000)).toBe('year')
  })
})
