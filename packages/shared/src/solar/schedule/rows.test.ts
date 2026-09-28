import { describe, it, expect } from 'vitest'
import { ganttStatusOf } from './status'
import {
  applyScheduleFilters, buildScheduleRows, reorderTaskIds, isScheduleFilters, filterCount,
  EMPTY_SCHEDULE_FILTERS, type ScheduleTaskView,
} from './rows'

const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `wi-${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: '', zone: '',
  start: '2026-10-01', end: '2026-10-02', isMilestone: false, status: 'not_started', awaitingSignOff: false, gatekeeperId: null,
  progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann', sortOrder: 1, description: '',
  updatedAt: 'T', segments: [], ...over,
})

describe('ganttStatusOf', () => {
  it('maps the work item’s universal status onto the Gantt vocabulary', () => {
    expect(ganttStatusOf('closed', 'in_progress')).toEqual({ status: 'done', awaitingSignOff: false })
    expect(ganttStatusOf('answered', 'done')).toEqual({ status: 'done', awaitingSignOff: true })
    expect(ganttStatusOf('open', 'in_progress')).toEqual({ status: 'in_progress', awaitingSignOff: false })
    expect(ganttStatusOf('open', 'done')).toEqual({ status: 'in_progress', awaitingSignOff: false })
    expect(ganttStatusOf('triage', 'not_started')).toEqual({ status: 'not_started', awaitingSignOff: false })
    expect(ganttStatusOf('void', 'done')).toBeNull()
  })
})

describe('filters', () => {
  const tasks = [
    task('1', { name: 'Design', status: 'done', ownerId: 'u1', colour: '#ef4444' }),
    task('2', { name: 'Install', status: 'in_progress', ownerId: 'u2' }),
    task('3', { name: 'Handover', isMilestone: true, ownerId: 'u2' }),
  ]
  it('search matches name or ref, case-insensitive', () => {
    expect(applyScheduleFilters(tasks, { ...EMPTY_SCHEDULE_FILTERS, search: 'inst' }, true).map((t) => t.id)).toEqual(['2'])
    expect(applyScheduleFilters(tasks, { ...EMPTY_SCHEDULE_FILTERS, search: 'solar-3' }, true).map((t) => t.id)).toEqual(['3'])
  })
  it('status, owner and colour filters combine with AND', () => {
    const f = { ...EMPTY_SCHEDULE_FILTERS, ownerIds: ['u2'], statuses: ['in_progress' as const] }
    expect(applyScheduleFilters(tasks, f, true).map((t) => t.id)).toEqual(['2'])
    expect(applyScheduleFilters(tasks, { ...EMPTY_SCHEDULE_FILTERS, colours: ['#ef4444'] }, true).map((t) => t.id)).toEqual(['1'])
    expect(filterCount(f)).toBe(2)
  })
  it('hides milestones when the Milestones toggle is off', () => {
    expect(applyScheduleFilters(tasks, EMPTY_SCHEDULE_FILTERS, false).map((t) => t.id)).toEqual(['1', '2'])
  })
  it('validates a stored preset', () => {
    expect(isScheduleFilters(EMPTY_SCHEDULE_FILTERS)).toBe(true)
    expect(isScheduleFilters({ search: '', statuses: ['nope'], ownerIds: [], colours: [] })).toBe(false)
    expect(isScheduleFilters({ search: 1 })).toBe(false)
  })
})

describe('buildScheduleRows — one row list drives BOTH the list and the bars', () => {
  const tasks = [
    task('a', { category: 'Design', zone: 'Roof A', sortOrder: 2 }),
    task('b', { category: 'Install', zone: 'Roof A', sortOrder: 1 }),
    task('c', { category: 'Design', zone: 'Roof B', sortOrder: 3 }),
  ]
  it('none: tasks in sort order, depth 0', () => {
    expect(buildScheduleRows(tasks, 'none', new Set()).map((r) => (r.kind === 'task' ? r.task.id : r.key)))
      .toEqual(['b', 'a', 'c'])
  })
  it('category: group header then its tasks, groups in first-appearance order', () => {
    const rows = buildScheduleRows(tasks, 'category', new Set())
    expect(rows.map((r) => (r.kind === 'task' ? r.task.id : r.label))).toEqual(['Install', 'b', 'Design', 'a', 'c'])
    expect(rows[0]).toMatchObject({ kind: 'group', count: 1, depth: 0 })
  })
  it('category_zone: two header levels; collapsing a category hides its zones and tasks', () => {
    const rows = buildScheduleRows(tasks, 'category_zone', new Set(['category:Design']))
    expect(rows.map((r) => (r.kind === 'task' ? r.task.id : r.label))).toEqual(['Install', 'Roof A', 'b', 'Design'])
    expect(rows[1]).toMatchObject({ kind: 'group', depth: 1 })
    expect(rows[2]).toMatchObject({ kind: 'task', depth: 2 })
  })
  it('status groups follow the fixed status order and use readable labels', () => {
    const rows = buildScheduleRows([task('x', { status: 'done' }), task('y')], 'status', new Set())
    expect(rows.filter((r) => r.kind === 'group').map((r) => r.kind === 'group' && r.label)).toEqual(['Not started', 'Done'])
  })
  it('blank category and zone get a label, never an empty header', () => {
    const rows = buildScheduleRows([task('x')], 'category_zone', new Set())
    expect(rows.map((r) => (r.kind === 'group' ? r.label : r.task.id))).toEqual(['No category', 'No zone', 'x'])
  })
})

describe('reorderTaskIds works on ALL ids (WM reordered only the filtered list and collided)', () => {
  it('moves one id before another', () => {
    expect(reorderTaskIds(['a', 'b', 'c', 'd'], ['d'], 'b')).toEqual(['a', 'd', 'b', 'c'])
  })
  it('moves a selection, keeping its order, to the end', () => {
    expect(reorderTaskIds(['a', 'b', 'c', 'd'], ['c', 'a'], null)).toEqual(['b', 'd', 'a', 'c'])
  })
  it('dropping onto a moved id appends', () => {
    expect(reorderTaskIds(['a', 'b', 'c'], ['a'], 'a')).toEqual(['b', 'c', 'a'])
  })
})
