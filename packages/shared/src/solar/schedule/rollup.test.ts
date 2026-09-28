import { describe, it, expect } from 'vitest'
import { scheduleStats, baselineVariance, ownerWorkload, taskWorkDays, type RollupTask } from './rollup'
import { makeWorkCalendar, saHolidaySet } from './calendar'
import { criticalPath } from './cpm'

const cal = makeWorkCalendar('calendar')
const wcal = makeWorkCalendar('working', saHolidaySet(2026, 2026))
const r = (id: string, start: string, end: string, over: Partial<RollupTask> = {}): RollupTask =>
  ({ id, start, end, isMilestone: false, status: 'not_started', progress: 0, segments: [], ...over })

describe('taskWorkDays', () => {
  it('Σ segments for a split task, span otherwise, 0 for a milestone', () => {
    expect(taskWorkDays(cal, r('a', '2026-10-01', '2026-10-10', {
      segments: [{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-08', end: '2026-10-10' }],
    }))).toBe(5)
    expect(taskWorkDays(cal, r('a', '2026-10-01', '2026-10-10'))).toBe(10)
    expect(taskWorkDays(cal, r('m', '2026-10-01', '2026-10-01', { isMilestone: true }))).toBe(0)
  })
})

describe('scheduleStats', () => {
  const tasks = [
    r('a', '2026-10-01', '2026-10-10', { status: 'done', progress: 40 }), // done counts as 100
    r('b', '2026-10-11', '2026-10-12', { status: 'in_progress', progress: 50 }),
    r('m', '2026-10-15', '2026-10-15', { isMilestone: true }),
  ]
  it('weights progress by duration and counts milestones apart', () => {
    const s = scheduleStats(tasks, cal, criticalPath(tasks, [], cal))
    expect(s.taskCount).toBe(2)
    expect(s.milestoneCount).toBe(1)
    expect(s.byStatus).toEqual({ not_started: 0, in_progress: 1, done: 1 })
    expect(s.completionPct).toBe(50)
    expect(s.weightedProgressPct).toBe(Math.round((10 * 100 + 2 * 50) / 12)) // 92
    expect(s.programmeDays).toBe(15)
    // CPM (Part 1) gives a milestone zero duration: the critical path runs from
    // the start of 1 Oct to the INSTANT of 15 Oct = 14 days, while
    // programmeDays counts the inclusive span of dates = 15.
    expect(s.criticalPathDays).toBe(14)
  })
  it('empty schedule: nulls, not NaN', () => {
    const s = scheduleStats([], cal, null)
    expect(s.completionPct).toBeNull()
    expect(s.weightedProgressPct).toBeNull()
    expect(s.programmeDays).toBe(0)
    expect(s.criticalPathDays).toBeNull()
  })
})

describe('baselineVariance', () => {
  it('reports start and finish slip in the calendar’s units, plus added and removed tasks', () => {
    const v = baselineVariance(
      [{ id: 'a', start: '2026-09-23', end: '2026-09-28' }, { id: 'new', start: '2026-10-01', end: '2026-10-01' }],
      [
        { taskId: 'a', name: 'A', start: '2026-09-21', end: '2026-09-23' },
        { taskId: null, name: 'Removed', start: '2026-09-01', end: '2026-09-02' },
      ],
      wcal,
    )
    expect(v.rows.get('a')).toEqual({ taskId: 'a', startDays: 2, finishDays: 2 }) // Heritage Day + weekend skipped
    expect(v.added).toEqual(['new'])
    expect(v.removed.map((b) => b.name)).toEqual(['Removed'])
  })
})

describe('ownerWorkload', () => {
  const tasks = [
    { id: 't1', ownerId: 'u1', start: '2026-09-28', end: '2026-09-30', isMilestone: false, status: 'not_started' as const },
    { id: 't2', ownerId: 'u1', start: '2026-09-29', end: '2026-10-01', isMilestone: false, status: 'in_progress' as const },
    { id: 't3', ownerId: 'u1', start: '2026-09-30', end: '2026-09-30', isMilestone: false, status: 'not_started' as const },
    { id: 't4', ownerId: 'u1', start: '2026-09-30', end: '2026-09-30', isMilestone: false, status: 'done' as const },
    { id: 't5', ownerId: 'u2', start: '2026-10-05', end: '2026-10-05', isMilestone: false, status: 'not_started' as const },
  ]
  it('peak concurrency per owner per week; done tasks and milestones do not load anyone', () => {
    const w = ownerWorkload(tasks, 2, cal)
    const u1 = w.find((o) => o.ownerId === 'u1')!
    expect(u1.weeks).toEqual([{ weekStart: '2026-09-28', maxConcurrent: 3, taskIds: ['t1', 't2', 't3'], overloaded: true }])
    expect(ownerWorkload(tasks, 3, cal).find((o) => o.ownerId === 'u1')!.weeks[0].overloaded).toBe(false)
    expect(w.find((o) => o.ownerId === 'u2')!.weeks[0]).toMatchObject({ weekStart: '2026-10-05', maxConcurrent: 1 })
  })
  it('weekends and holidays carry no load', () => {
    const w = ownerWorkload([{ id: 'x', ownerId: 'u1', start: '2026-09-26', end: '2026-09-27', isMilestone: false, status: 'not_started' }], 1, cal)
    expect(w).toEqual([{ ownerId: 'u1', weeks: [] }])
  })
})
