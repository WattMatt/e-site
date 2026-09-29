import { describe, it, expect } from 'vitest'
import { layoutGantt, xOfDate, dateAtX, GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type GanttLayoutInput } from './layout'
import { buildScheduleRows, type ScheduleTaskView } from './rows'
import { makeWorkCalendar, saHolidaySet } from './calendar'

const task = (id: string, start: string, end: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: id, ref: id, name: id, category: 'C', zone: '', start, end, isMilestone: false, status: 'not_started',
  awaitingSignOff: false, gatekeeperId: null, progress: 0, colour: '#3b82f6', ownerId: 'u', ownerName: 'U', sortOrder: 1, description: '',
  updatedAt: 'T', segments: [], ...over,
})
const base = (over: Partial<GanttLayoutInput>): GanttLayoutInput => ({
  rows: [], zoom: 'week', cal: makeWorkCalendar('calendar', saHolidaySet(2026, 2026)), today: '2026-10-01',
  splitBars: true, links: [], showLinks: true, critical: new Set(), criticalLinks: new Set(), baseline: null, ...over,
})

describe('layoutGantt', () => {
  it('places a bar from its start to the END of its last day', () => {
    const l = layoutGantt(base({ rows: buildScheduleRows([task('a', '2026-10-05', '2026-10-07')], 'none', new Set()) }))
    expect(l.rangeStart).toBe('2026-09-28')
    expect(l.dayWidth).toBe(14)
    expect(l.bars).toEqual([expect.objectContaining({ taskId: 'a', kind: 'task', x: 98, w: 42, rowIndex: 0 })])
    expect(xOfDate(l, '2026-10-05')).toBe(98)
    expect(dateAtX(l, 98 + 13)).toBe('2026-10-05')
  })
  it('a group header takes a row in the chart too, so bars line up with names', () => {
    const l = layoutGantt(base({ rows: buildScheduleRows([task('a', '2026-10-05', '2026-10-07')], 'category', new Set()) }))
    expect(l.bars[0].rowIndex).toBe(1)
    expect(l.bars[0].y).toBe(GANTT_HEADER_HEIGHT + GANTT_ROW_HEIGHT + 6)
    expect(l.height).toBe(GANTT_HEADER_HEIGHT + 2 * GANTT_ROW_HEIGHT)
  })
  it('shades weekends and SA public holidays', () => {
    const l = layoutGantt(base({ rows: buildScheduleRows([task('a', '2026-09-21', '2026-09-25')], 'none', new Set()) }))
    expect(l.shades.find((s) => s.kind === 'holiday')).toEqual({ x: xOfDate(l, '2026-09-24'), w: 14, kind: 'holiday' })
    expect(l.shades.filter((s) => s.kind === 'weekend').length).toBeGreaterThan(0)
  })
  it('a milestone is a point at the middle of its day', () => {
    const l = layoutGantt(base({ rows: buildScheduleRows([task('m', '2026-10-05', '2026-10-05', { isMilestone: true })], 'none', new Set()) }))
    expect(l.bars[0]).toMatchObject({ kind: 'milestone', x: 98 + 7, w: 0 })
  })
  it('split bars draw segments only when the toggle is on', () => {
    const t = task('s', '2026-10-01', '2026-10-10', { segments: [{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-08', end: '2026-10-10' }] })
    const rows = buildScheduleRows([t], 'none', new Set())
    expect(layoutGantt(base({ rows })).bars.map((b) => b.kind)).toEqual(['segment', 'segment'])
    expect(layoutGantt(base({ rows, splitBars: false })).bars.map((b) => b.kind)).toEqual(['task'])
  })
  it('draws a link only when both ends are on screen, and marks critical links', () => {
    const rows = buildScheduleRows([task('a', '2026-10-01', '2026-10-02'), task('b', '2026-10-05', '2026-10-06', { sortOrder: 2 })], 'none', new Set())
    const links = [{ predecessorId: 'a', successorId: 'b', type: 'FS' as const, lagDays: 0 }]
    const l = layoutGantt(base({ rows, links, criticalLinks: new Set(['a>b']) }))
    expect(l.links).toHaveLength(1)
    expect(l.links[0].critical).toBe(true)
    expect(l.links[0].points.slice(0, 2)).toEqual([xOfDate(l, '2026-10-03'), l.bars[0].y + l.bars[0].h / 2])
    expect(layoutGantt(base({ rows: rows.slice(0, 1), links })).links).toEqual([])
    expect(layoutGantt(base({ rows, links, showLinks: false })).links).toEqual([])
  })
  it('falls back to a coarser zoom rather than build an enormous canvas', () => {
    const l = layoutGantt(base({ zoom: 'day', rows: buildScheduleRows([task('a', '2026-01-01', '2027-12-31')], 'none', new Set()) }))
    expect(l.zoom).toBe('week')
    expect(l.clamped).toBe(true)
    expect(l.width).toBeLessThanOrEqual(16_000)
  })
  it('an empty schedule still has a range around today; today outside the range has no line', () => {
    expect(layoutGantt(base({})).todayX).toBe(7 * 14)
    const l = layoutGantt(base({ today: '2030-01-01', rows: buildScheduleRows([task('a', '2026-10-01', '2026-10-02')], 'none', new Set()) }))
    expect(l.todayX).toBeNull()
  })
  it('draws the compared baseline under the live bar', () => {
    const rows = buildScheduleRows([task('a', '2026-10-05', '2026-10-07')], 'none', new Set())
    const l = layoutGantt(base({ rows, baseline: new Map([['a', { start: '2026-10-01', end: '2026-10-02' }]]) }))
    expect(l.rangeStart).toBe('2026-09-24')
    expect(l.baselineBars).toEqual([{ taskId: 'a', x: xOfDate(l, '2026-10-01'), y: GANTT_HEADER_HEIGHT + GANTT_ROW_HEIGHT - 5, w: 28 }])
  })
})
