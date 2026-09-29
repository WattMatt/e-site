# E-Site Solar Phase 5b — Schedule (Gantt) — Part 2 of 5: view model, roll-up, template, import, ICS, layout

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal / Architecture / Tech stack / Ground rules:** see Part 1 (`2026-09-28-solar-phase-5b-schedule-1-engine.md`). **Prerequisite:** Part 1 Tasks 0–3 committed on `feat/solar-phase-5b`.

Everything in this part is pure TypeScript in `packages/shared/src/solar/schedule/`.

---

### Task 4: Status, rows, filters, grouping, reorder, drag — `status.ts`, `rows.ts`, `drag.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/status.ts`, `rows.ts`, `drag.ts`
- Create: `packages/shared/src/solar/schedule/rows.test.ts`, `drag.test.ts`

**Status model (decided here, enforced by the migration in Task 11).** The Gantt vocabulary is `not_started | in_progress | done`, stored in `solar.schedule_tasks.gantt_status`. The work item's universal status (`projects.work_items.status`) is kept in step by the RPC: not started / in progress → `open`; done → `closed` when the actor is the task's gatekeeper (its creator — `gatekeeper_rule = 'creator'`), otherwise `answered` ("Done — awaiting sign-off", ball to the gatekeeper), because the 00196 transition guard lets only the gatekeeper close. Anyone may also move the work item in My Work; the Gantt reads the result through `ganttStatusOf()`: `closed` → done, `answered` → done + awaiting sign-off, `void` → not on the Gantt, `open` with a stored `done` → in progress (it was reopened). `work_items.source_status` is deliberately **not** used: PR #193 (`00202`) makes it immutable to client sessions.

- [ ] **Step 1: Write the failing tests**

`packages/shared/src/solar/schedule/rows.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { ganttStatusOf } from './status'
import {
  applyScheduleFilters, buildScheduleRows, reorderTaskIds, isScheduleFilters, filterCount,
  EMPTY_SCHEDULE_FILTERS, type ScheduleTaskView,
} from './rows'

const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `wi-${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: '', zone: '',
  start: '2026-10-01', end: '2026-10-02', isMilestone: false, status: 'not_started', awaitingSignOff: false,
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
```

`packages/shared/src/solar/schedule/drag.test.ts`:
```ts
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
```

- [ ] **Step 2: Run them — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/rows.test.ts src/solar/schedule/drag.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement `status.ts`**

`packages/shared/src/solar/schedule/status.ts`:
```ts
/**
 * Gantt status (spec §14.1: not started / in progress / done). Stored in
 * solar.schedule_tasks.gantt_status; the work item's universal status is kept
 * in step by the RPCs in 00213. This function is the READ side only.
 */
export const GANTT_STATUSES = ['not_started', 'in_progress', 'done'] as const
export type GanttStatus = (typeof GANTT_STATUSES)[number]
export const GANTT_STATUS_LABELS: Record<GanttStatus, string> = {
  not_started: 'Not started', in_progress: 'In progress', done: 'Done',
}
export const isGanttStatus = (v: unknown): v is GanttStatus => (GANTT_STATUSES as readonly unknown[]).includes(v)

export function ganttStatusOf(
  workItemStatus: string,
  stored: GanttStatus,
): { status: GanttStatus; awaitingSignOff: boolean } | null {
  if (workItemStatus === 'void') return null
  if (workItemStatus === 'closed') return { status: 'done', awaitingSignOff: false }
  if (workItemStatus === 'answered') return { status: 'done', awaitingSignOff: true }
  return { status: stored === 'done' ? 'in_progress' : stored, awaitingSignOff: false }
}
```

- [ ] **Step 4: Implement `rows.ts`**

`packages/shared/src/solar/schedule/rows.ts`:
```ts
/** The Schedule tab's view model: filters, grouping rows and reorder (spec §14.1–14.2). */
import type { CalendarDate } from './dates'
import { GANTT_STATUSES, GANTT_STATUS_LABELS, isGanttStatus, type GanttStatus } from './status'

export interface ScheduleSegment {
  readonly start: CalendarDate
  readonly end: CalendarDate
}

export interface ScheduleTaskView {
  id: string
  workItemId: string
  ref: string
  name: string
  category: string
  zone: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
  status: GanttStatus
  awaitingSignOff: boolean
  progress: number
  colour: string
  ownerId: string
  ownerName: string
  sortOrder: number
  description: string
  updatedAt: string
  segments: ScheduleSegment[]
}

export interface ScheduleFilters {
  search: string
  statuses: GanttStatus[]
  ownerIds: string[]
  colours: string[]
}

export const EMPTY_SCHEDULE_FILTERS: ScheduleFilters = { search: '', statuses: [], ownerIds: [], colours: [] }

const isStringArray = (v: unknown): v is string[] => Array.isArray(v) && v.every((x) => typeof x === 'string')

/** A preset read back from solar.schedule_filter_presets.filters (jsonb) — never trusted blindly. */
export function isScheduleFilters(v: unknown): v is ScheduleFilters {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.search === 'string'
    && Array.isArray(o.statuses) && o.statuses.every(isGanttStatus)
    && isStringArray(o.ownerIds) && isStringArray(o.colours)
}

/** Filters counted on the Filters button badge (search has its own box). */
export function filterCount(f: ScheduleFilters): number {
  return f.statuses.length + f.ownerIds.length + f.colours.length
}

export function applyScheduleFilters(
  tasks: readonly ScheduleTaskView[],
  f: ScheduleFilters,
  showMilestones: boolean,
): ScheduleTaskView[] {
  const q = f.search.trim().toLowerCase()
  return tasks.filter((t) =>
    (showMilestones || !t.isMilestone)
    && (!q || t.name.toLowerCase().includes(q) || t.ref.toLowerCase().includes(q))
    && (f.statuses.length === 0 || f.statuses.includes(t.status))
    && (f.ownerIds.length === 0 || f.ownerIds.includes(t.ownerId))
    && (f.colours.length === 0 || f.colours.includes(t.colour)))
}

export const SCHEDULE_GROUP_BYS = ['none', 'status', 'owner', 'colour', 'category', 'category_zone'] as const
export type ScheduleGroupBy = (typeof SCHEDULE_GROUP_BYS)[number]
export const SCHEDULE_GROUP_BY_LABELS: Record<ScheduleGroupBy, string> = {
  none: 'No grouping', status: 'Status', owner: 'Owner', colour: 'Colour', category: 'Category', category_zone: 'Category & zone',
}

export type ScheduleRow =
  | { kind: 'group'; key: string; label: string; depth: number; count: number; collapsed: boolean }
  | { kind: 'task'; task: ScheduleTaskView; depth: number }

const categoryLabel = (c: string) => (c.trim() ? c : 'No category')
const zoneLabel = (z: string) => (z.trim() ? z : 'No zone')

function groupsInOrder<T>(items: readonly T[], keyOf: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>()
  for (const it of items) {
    const k = keyOf(it)
    if (!m.has(k)) m.set(k, [])
    m.get(k)!.push(it)
  }
  return m
}

/**
 * The ONE row list. The DOM list and the Konva bars both index into it, so a
 * group header occupies a row in both and names always line up with bars
 * (WM grouped the list but drew the bars flat — as-is/06 B.7 D4).
 */
export function buildScheduleRows(
  tasks: readonly ScheduleTaskView[],
  groupBy: ScheduleGroupBy,
  collapsed: ReadonlySet<string>,
): ScheduleRow[] {
  const sorted = [...tasks].sort((a, b) => a.sortOrder - b.sortOrder || a.id.localeCompare(b.id))
  if (groupBy === 'none') return sorted.map((task) => ({ kind: 'task', task, depth: 0 }))

  const rows: ScheduleRow[] = []
  if (groupBy === 'category_zone') {
    for (const [cat, inCat] of groupsInOrder(sorted, (t) => t.category)) {
      const ck = `category:${cat}`
      const cOpen = !collapsed.has(ck)
      rows.push({ kind: 'group', key: ck, label: categoryLabel(cat), depth: 0, count: inCat.length, collapsed: !cOpen })
      if (!cOpen) continue
      for (const [zone, inZone] of groupsInOrder(inCat, (t) => t.zone)) {
        const zk = `zone:${cat}\u0000${zone}`
        const zOpen = !collapsed.has(zk)
        rows.push({ kind: 'group', key: zk, label: zoneLabel(zone), depth: 1, count: inZone.length, collapsed: !zOpen })
        if (zOpen) for (const task of inZone) rows.push({ kind: 'task', task, depth: 2 })
      }
    }
    return rows
  }

  const keyOf = (t: ScheduleTaskView): string =>
    groupBy === 'status' ? t.status : groupBy === 'owner' ? t.ownerId : groupBy === 'colour' ? t.colour : t.category
  let groups = groupsInOrder(sorted, keyOf)
  if (groupBy === 'status') {
    groups = new Map(GANTT_STATUSES.filter((s) => groups.has(s)).map((s) => [s, groups.get(s)!]))
  }
  for (const [k, items] of groups) {
    const label =
      groupBy === 'status' ? GANTT_STATUS_LABELS[k as GanttStatus]
        : groupBy === 'owner' ? items[0].ownerName || 'No owner'
          : groupBy === 'colour' ? k
            : categoryLabel(k)
    const key = `${groupBy}:${k}`
    const open = !collapsed.has(key)
    rows.push({ kind: 'group', key, label, depth: 0, count: items.length, collapsed: !open })
    if (open) for (const task of items) rows.push({ kind: 'task', task, depth: 1 })
  }
  return rows
}

/** New order of ALL task ids after moving `moved` before `beforeId` (null = to the end). */
export function reorderTaskIds(allIds: readonly string[], moved: readonly string[], beforeId: string | null): string[] {
  const movedSet = new Set(moved)
  const movedInOrder = allIds.filter((id) => movedSet.has(id))
  const rest = allIds.filter((id) => !movedSet.has(id))
  const at = beforeId === null || movedSet.has(beforeId) ? rest.length : rest.indexOf(beforeId)
  const idx = at === -1 ? rest.length : at
  return [...rest.slice(0, idx), ...movedInOrder, ...rest.slice(idx)]
}
```

- [ ] **Step 5: Implement `drag.ts`**

`packages/shared/src/solar/schedule/drag.ts`:
```ts
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
```

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/rows.test.ts src/solar/schedule/drag.test.ts`
Expected: PASS (all).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/schedule/status.ts packages/shared/src/solar/schedule/rows.ts packages/shared/src/solar/schedule/drag.ts packages/shared/src/solar/schedule/rows.test.ts packages/shared/src/solar/schedule/drag.test.ts
git commit -m "feat(solar-schedule): Gantt status mapping, aligned group rows, full-list reorder, drag + split maths

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Roll-up, baseline variance, owner workload — `rollup.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/rollup.ts`
- Create: `packages/shared/src/solar/schedule/rollup.test.ts`

Spec §14.2 Stats panel: overall completion %, tasks by status, average progress **weighted by duration**, programme duration, critical-path length. Baselines: "Compare shows baseline bars and **variance days**" (WM had none). Workload: "tasks per owner per week; highlights > N concurrent tasks (setting)".

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/rollup.test.ts`:
```ts
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
    expect(s.criticalPathDays).toBe(15)
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/rollup.test.ts`
Expected: FAIL — cannot resolve `./rollup`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/schedule/rollup.ts`:
```ts
/** Stats panel, baseline variance and the resource workload view (spec §14.1–14.2). */
import { addCalendarDays, maxCalendarDate, minCalendarDate, mondayOf, type CalendarDate } from './dates'
import { isWorkingDate, makeWorkCalendar, signedShift, spanDays, type WorkCalendar } from './calendar'
import type { CpmResult } from './cpm'
import type { ScheduleSegment } from './rows'
import type { GanttStatus } from './status'

export interface RollupTask {
  id: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
  status: GanttStatus
  progress: number
  segments: readonly ScheduleSegment[]
}

export function taskWorkDays(cal: WorkCalendar, t: RollupTask): number {
  if (t.isMilestone) return 0
  if (t.segments.length >= 2) return t.segments.reduce((n, s) => n + spanDays(cal, s.start, s.end), 0)
  return spanDays(cal, t.start, t.end)
}

export interface ScheduleStats {
  taskCount: number
  milestoneCount: number
  byStatus: Record<GanttStatus, number>
  completionPct: number | null
  weightedProgressPct: number | null
  programmeDays: number
  criticalPathDays: number | null
}

export function scheduleStats(tasks: readonly RollupTask[], cal: WorkCalendar, cpm: CpmResult | null): ScheduleStats {
  const work = tasks.filter((t) => !t.isMilestone)
  const byStatus: Record<GanttStatus, number> = { not_started: 0, in_progress: 0, done: 0 }
  let wSum = 0
  let pSum = 0
  for (const t of work) {
    byStatus[t.status]++
    const w = Math.max(1, taskWorkDays(cal, t))
    const p = t.status === 'done' ? 100 : Math.min(100, Math.max(0, t.progress))
    wSum += w
    pSum += w * p
  }
  const start = minCalendarDate(tasks.map((t) => t.start))
  const end = maxCalendarDate(tasks.map((t) => t.end))
  return {
    taskCount: work.length,
    milestoneCount: tasks.length - work.length,
    byStatus,
    completionPct: work.length ? Math.round((100 * byStatus.done) / work.length) : null,
    weightedProgressPct: wSum ? Math.round(pSum / wSum) : null,
    programmeDays: start && end ? spanDays(cal, start, end) : 0,
    criticalPathDays: cpm && cpm.ok ? cpm.lengthDays : null,
  }
}

export interface BaselineTaskRow {
  taskId: string | null
  name: string
  start: CalendarDate
  end: CalendarDate
}
export interface VarianceRow { taskId: string; startDays: number; finishDays: number }

/** Positive = later than the baseline (slip). */
export function baselineVariance(
  live: ReadonlyArray<{ id: string; start: CalendarDate; end: CalendarDate }>,
  baseline: readonly BaselineTaskRow[],
  cal: WorkCalendar,
): { rows: Map<string, VarianceRow>; added: string[]; removed: BaselineTaskRow[] } {
  const byTask = new Map(baseline.filter((b) => b.taskId).map((b) => [b.taskId as string, b]))
  const liveIds = new Set(live.map((t) => t.id))
  const rows = new Map<string, VarianceRow>()
  const added: string[] = []
  for (const t of live) {
    const b = byTask.get(t.id)
    if (!b) { added.push(t.id); continue }
    rows.set(t.id, { taskId: t.id, startDays: signedShift(cal, b.start, t.start), finishDays: signedShift(cal, b.end, t.end) })
  }
  const removed = baseline.filter((b) => !b.taskId || !liveIds.has(b.taskId))
  return { rows, added, removed }
}

export interface WorkloadWeek { weekStart: CalendarDate; maxConcurrent: number; taskIds: string[]; overloaded: boolean }
export interface OwnerWorkload { ownerId: string; weeks: WorkloadWeek[] }

/** Peak concurrent open tasks per owner per ISO week, counted on working days only. */
export function ownerWorkload(
  tasks: ReadonlyArray<{ id: string; ownerId: string; start: CalendarDate; end: CalendarDate; isMilestone: boolean; status: GanttStatus }>,
  threshold: number,
  cal: WorkCalendar,
): OwnerWorkload[] {
  const workdays = makeWorkCalendar('working', cal.holidays)
  const owners = new Map<string, { day: Map<CalendarDate, number>; week: Map<CalendarDate, Set<string>> }>()
  for (const t of tasks) {
    if (!owners.has(t.ownerId)) owners.set(t.ownerId, { day: new Map(), week: new Map() })
    if (t.isMilestone || t.status === 'done') continue
    const o = owners.get(t.ownerId)!
    for (let d = t.start; d <= t.end; d = addCalendarDays(d, 1)) {
      if (!isWorkingDate(workdays, d)) continue
      o.day.set(d, (o.day.get(d) ?? 0) + 1)
      const wk = mondayOf(d)
      if (!o.week.has(wk)) o.week.set(wk, new Set())
      o.week.get(wk)!.add(t.id)
    }
  }
  return [...owners.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([ownerId, o]) => ({
    ownerId,
    weeks: [...o.week.keys()].sort().map((weekStart) => {
      let max = 0
      for (let i = 0; i < 7; i++) max = Math.max(max, o.day.get(addCalendarDays(weekStart, i)) ?? 0)
      return { weekStart, maxConcurrent: max, taskIds: [...o.week.get(weekStart)!].sort(), overloaded: max > threshold }
    }),
  }))
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/rollup.test.ts`
Expected: PASS (7 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/schedule/rollup.ts packages/shared/src/solar/schedule/rollup.test.ts
git commit -m "feat(solar-schedule): duration-weighted stats, baseline variance days, owner workload

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Standard solar programme template — `template.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/import/plan.ts` (the import/seed model, used by Tasks 6–7)
- Create: `packages/shared/src/solar/schedule/template.ts`
- Create: `packages/shared/src/solar/schedule/template.test.ts`

"Use template — inserts the org's Solar schedule template (editable in org settings), dates relative to a chosen start date." The org's copy lives in `solar.schedule_templates.content` (Task 11) as `{ version: 1, items: [...] }`; without one, `DEFAULT_SOLAR_SCHEDULE_TEMPLATE` is used. Instantiation forward-schedules each item after its predecessors so the seeded programme has **zero** link violations (asserted with `criticalPath`).

- [ ] **Step 1: Write the import plan model (no behaviour to test on its own; validated in Task 7)**

`packages/shared/src/solar/schedule/import/plan.ts`:
```ts
/**
 * What a template or an import file becomes before it is committed: tasks
 * keyed by a client key and links between keys. solar.schedule_create_tasks
 * (00213) takes exactly this shape (snake_cased by the action), in ONE
 * transaction — WM inserted row by row with a toast each (as-is/06 B.7 D7).
 */
import { isCalendarDate, type CalendarDate } from '../dates'
import { findCycle, isLinkType, type LinkType } from '../graph'
import { isGanttStatus, type GanttStatus } from '../status'
import type { ScheduleSegment } from '../rows'

export const MAX_IMPORT_TASKS = 2000

export interface PlannedTask {
  key: string
  /** Row in the source file (1-based), for messages; null for a template item. */
  sourceRow: number | null
  name: string
  category: string
  zone: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
  progress: number
  status: GanttStatus
  colour: string | null
  /** Owner as written in the file (name or email); resolved to a member on commit. */
  ownerHint: string | null
  description: string
  segments: ScheduleSegment[]
}

export interface PlannedLink { fromKey: string; toKey: string; type: LinkType; lagDays: number }
export interface ImportPlan { tasks: PlannedTask[]; links: PlannedLink[] }
export interface ImportIssue { row: number | null; message: string }

const COLOUR = /^#[0-9a-f]{6}$/

export function validateImportPlan(plan: ImportPlan): ImportIssue[] {
  const issues: ImportIssue[] = []
  if (plan.tasks.length === 0) return [{ row: null, message: 'The file has no tasks.' }]
  if (plan.tasks.length > MAX_IMPORT_TASKS) issues.push({ row: null, message: 'At most 2,000 tasks can be imported at once.' })
  const keys = new Set<string>()
  const names = new Map<string, string>()
  for (const t of plan.tasks) {
    const at = t.sourceRow
    if (keys.has(t.key)) issues.push({ row: at, message: `Two tasks share the reference "${t.key}".` })
    keys.add(t.key)
    names.set(t.key, t.name || t.key)
    if (!t.name.trim()) issues.push({ row: at, message: 'A task has no name.' })
    if (!isCalendarDate(t.start) || !isCalendarDate(t.end)) {
      issues.push({ row: at, message: `"${t.name}" has a date that is not a real calendar date.` })
      continue
    }
    if (t.end < t.start) issues.push({ row: at, message: `"${t.name}" ends before it starts.` })
    if (t.isMilestone && t.start !== t.end) issues.push({ row: at, message: `Milestone "${t.name}" must start and end on the same day.` })
    if (!Number.isInteger(t.progress) || t.progress < 0 || t.progress > 100) issues.push({ row: at, message: `"${t.name}" has a progress outside 0–100 %.` })
    if (!isGanttStatus(t.status)) issues.push({ row: at, message: `"${t.name}" has an unknown status.` })
    if (t.colour !== null && !COLOUR.test(t.colour)) issues.push({ row: at, message: `"${t.name}" has a colour that is not #rrggbb.` })
  }
  for (const l of plan.links) {
    if (!keys.has(l.fromKey) || !keys.has(l.toKey)) issues.push({ row: null, message: `A dependency points at a task that is not in the file (${l.fromKey} → ${l.toKey}).` })
    else if (l.fromKey === l.toKey) issues.push({ row: null, message: `"${names.get(l.fromKey)}" cannot depend on itself.` })
    if (!isLinkType(l.type)) issues.push({ row: null, message: 'A dependency has an unknown type (use FS, SS, FF or SF).' })
  }
  const cycle = findCycle([...keys], plan.links
    .filter((l) => keys.has(l.fromKey) && keys.has(l.toKey) && l.fromKey !== l.toKey)
    .map((l) => ({ predecessorId: l.fromKey, successorId: l.toKey, type: l.type, lagDays: l.lagDays })))
  if (cycle) {
    const path = [...cycle, cycle[0]].map((k) => names.get(k)).join(' → ')
    issues.push({ row: null, message: `These tasks depend on each other in a loop: ${path}.` })
  }
  return issues
}
```

- [ ] **Step 2: Write the failing template test**

`packages/shared/src/solar/schedule/template.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  DEFAULT_SOLAR_SCHEDULE_TEMPLATE, instantiateScheduleTemplate, validateScheduleTemplate, readScheduleTemplate,
  type ScheduleTemplateItem,
} from './template'
import { validateImportPlan } from './import/plan'
import { criticalPath } from './cpm'
import { makeWorkCalendar, saHolidaySet, isWorkingDate } from './calendar'

const wcal = makeWorkCalendar('working', saHolidaySet(2026, 2027))
const cal = makeWorkCalendar('calendar')

describe('the default template', () => {
  it('is valid and covers design, approvals, procurement, installation, commissioning, handover', () => {
    expect(validateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE)).toEqual([])
    expect(new Set(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.map((i) => i.category)))
      .toEqual(new Set(['Design', 'Approvals', 'Procurement', 'Installation', 'Commissioning', 'Handover']))
  })
})

describe('instantiateScheduleTemplate', () => {
  for (const [name, c] of [['working', wcal], ['calendar', cal]] as const) {
    it(`${name} mode: seeded programme breaks no link and passes import validation`, () => {
      const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-01', c)
      expect(validateImportPlan(plan)).toEqual([])
      const cpm = criticalPath(
        plan.tasks.map((t) => ({ id: t.key, start: t.start, end: t.end, isMilestone: t.isMilestone })),
        plan.links.map((l) => ({ predecessorId: l.fromKey, successorId: l.toKey, type: l.type, lagDays: l.lagDays })),
        c,
      )
      expect(cpm.ok && cpm.violations).toEqual([])
      expect(plan.tasks[0].start).toBe('2026-10-01')
    })
  }
  it('working mode starts every task on a working day', () => {
    const plan = instantiateScheduleTemplate(DEFAULT_SOLAR_SCHEDULE_TEMPLATE, '2026-10-03', wcal) // a Saturday
    for (const t of plan.tasks) expect(isWorkingDate(wcal, t.start)).toBe(true)
  })
  it('FS lag and SS lag are honoured', () => {
    const items: ScheduleTemplateItem[] = [
      { key: 'a', name: 'A', category: 'X', zone: '', offsetDays: 0, durationDays: 3, isMilestone: false, after: [] },
      { key: 'b', name: 'B', category: 'X', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [{ key: 'a', type: 'FS', lagDays: 2 }] },
      { key: 'c', name: 'C', category: 'X', zone: '', offsetDays: 0, durationDays: 2, isMilestone: false, after: [{ key: 'a', type: 'SS', lagDays: 1 }] },
    ]
    const p = instantiateScheduleTemplate(items, '2026-10-01', cal)
    expect(p.tasks.find((t) => t.key === 'b')).toMatchObject({ start: '2026-10-06', end: '2026-10-07' })
    expect(p.tasks.find((t) => t.key === 'c')).toMatchObject({ start: '2026-10-02', end: '2026-10-03' })
  })
})

describe('validateScheduleTemplate / readScheduleTemplate', () => {
  it('refuses duplicate keys, unknown predecessors and loops', () => {
    const bad: ScheduleTemplateItem[] = [
      { key: 'a', name: 'A', category: '', zone: '', offsetDays: 0, durationDays: 1, isMilestone: false, after: [{ key: 'b', type: 'FS', lagDays: 0 }] },
      { key: 'b', name: 'B', category: '', zone: '', offsetDays: 0, durationDays: 1, isMilestone: false, after: [{ key: 'a', type: 'FS', lagDays: 0 }] },
      { key: 'b', name: '', category: '', zone: '', offsetDays: -1, durationDays: 0, isMilestone: false, after: [{ key: 'z', type: 'FS', lagDays: 0 }] },
    ]
    const errors = validateScheduleTemplate(bad)
    expect(errors).toEqual(expect.arrayContaining([
      'Two items share the key "b".', 'An item has no name.', 'Item "b" starts before day 0.',
      'Item "b" needs a duration of at least 1 day.', 'Item "b" follows "z", which is not in the template.',
    ]))
    expect(errors.some((e) => e.startsWith('The template has a loop'))).toBe(true)
  })
  it('reads a stored { version, items } and falls back to null on anything else', () => {
    expect(readScheduleTemplate({ version: 1, items: DEFAULT_SOLAR_SCHEDULE_TEMPLATE })).toHaveLength(DEFAULT_SOLAR_SCHEDULE_TEMPLATE.length)
    expect(readScheduleTemplate({ version: 1, items: [{ key: 'x' }] })).toBeNull()
    expect(readScheduleTemplate(null)).toBeNull()
  })
})
```

- [ ] **Step 3: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/template.test.ts`
Expected: FAIL — cannot resolve `./template`.

- [ ] **Step 4: Implement**

`packages/shared/src/solar/schedule/template.ts`:
```ts
/**
 * The Solar schedule template (spec §14.1 "Use template"). Stored per org in
 * solar.schedule_templates.content = { version: 1, items }. Offsets and
 * durations are in the schedule's duration mode. Instantiation forward-
 * schedules each item after its predecessors, so a seeded programme breaks no
 * link (asserted with criticalPath in the test).
 */
import { addCalendarDays, type CalendarDate } from './dates'
import { endForDuration, nextWorkingDate, shiftDate, type WorkCalendar } from './calendar'
import { findCycle, isLinkType, topoOrder, type LinkType } from './graph'
import type { ImportPlan, PlannedTask } from './import/plan'

export interface ScheduleTemplateItem {
  key: string
  name: string
  category: string
  zone: string
  /** Earliest start, in days after the chosen start date. */
  offsetDays: number
  durationDays: number
  isMilestone: boolean
  after: Array<{ key: string; type: LinkType; lagDays: number }>
}

export const SCHEDULE_TEMPLATE_VERSION = 1

const i = (key: string, name: string, category: string, durationDays: number, after: ScheduleTemplateItem['after'] = [], isMilestone = false): ScheduleTemplateItem =>
  ({ key, name, category, zone: '', offsetDays: 0, durationDays: isMilestone ? 0 : durationDays, isMilestone, after })
const fs = (key: string, lagDays = 0) => ({ key, type: 'FS' as const, lagDays })

export const DEFAULT_SOLAR_SCHEDULE_TEMPLATE: ScheduleTemplateItem[] = [
  i('survey', 'Site survey and design brief', 'Design', 5),
  i('design', 'Detailed design and PV layout', 'Design', 10, [fs('survey')]),
  i('structural', 'Structural assessment of the roof', 'Design', 5, [fs('survey')]),
  i('sseg_submit', 'SSEG application submitted', 'Approvals', 0, [fs('design')], true),
  i('sseg_approval', 'Utility SSEG approval', 'Approvals', 30, [fs('sseg_submit')]),
  i('procure_pv', 'Procure modules and inverters', 'Procurement', 20, [fs('design')]),
  i('procure_bos', 'Procure mounting and balance of system', 'Procurement', 15, [fs('design')]),
  i('mounting', 'Install mounting structure', 'Installation', 10, [fs('procure_bos'), fs('structural')]),
  i('modules', 'Install modules', 'Installation', 10, [{ key: 'mounting', type: 'SS', lagDays: 3 }, fs('procure_pv')]),
  i('inverters', 'Install inverters and AC reticulation', 'Installation', 5, [{ key: 'modules', type: 'FF', lagDays: 0 }]),
  i('commission', 'Testing and commissioning', 'Commissioning', 5, [fs('inverters'), fs('sseg_approval')]),
  i('coc', 'Certificate of Compliance and utility witness test', 'Commissioning', 2, [fs('commission')]),
  i('handover', 'Handover pack and client training', 'Handover', 3, [fs('coc')]),
  i('completion', 'Practical completion', 'Handover', 0, [fs('handover')], true),
]

export function validateScheduleTemplate(items: readonly ScheduleTemplateItem[]): string[] {
  const errors: string[] = []
  const keys = new Set<string>()
  for (const it of items) {
    if (keys.has(it.key)) errors.push(`Two items share the key "${it.key}".`)
    keys.add(it.key)
    if (!it.key.trim()) errors.push('An item has no key.')
    if (!it.name.trim()) errors.push('An item has no name.')
    if (!Number.isInteger(it.offsetDays) || it.offsetDays < 0) errors.push(`Item "${it.key}" starts before day 0.`)
    if (!it.isMilestone && (!Number.isInteger(it.durationDays) || it.durationDays < 1)) errors.push(`Item "${it.key}" needs a duration of at least 1 day.`)
  }
  for (const it of items) {
    for (const a of it.after) {
      if (!keys.has(a.key)) errors.push(`Item "${it.key}" follows "${a.key}", which is not in the template.`)
      if (!isLinkType(a.type)) errors.push(`Item "${it.key}" has an unknown link type.`)
    }
  }
  const cycle = findCycle([...keys], items.flatMap((it) => it.after.filter((a) => keys.has(a.key))
    .map((a) => ({ predecessorId: a.key, successorId: it.key, type: a.type, lagDays: a.lagDays }))))
  if (cycle) errors.push(`The template has a loop: ${[...cycle, cycle[0]].join(' → ')}.`)
  return errors
}

function isItem(v: unknown): v is ScheduleTemplateItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return typeof o.key === 'string' && typeof o.name === 'string' && typeof o.category === 'string'
    && typeof o.zone === 'string' && typeof o.offsetDays === 'number' && typeof o.durationDays === 'number'
    && typeof o.isMilestone === 'boolean' && Array.isArray(o.after)
    && o.after.every((a) => a && typeof a === 'object' && typeof (a as { key?: unknown }).key === 'string'
      && isLinkType((a as { type?: unknown }).type) && typeof (a as { lagDays?: unknown }).lagDays === 'number')
}

/** solar.schedule_templates.content → items, or null (caller falls back to the default). */
export function readScheduleTemplate(stored: unknown): ScheduleTemplateItem[] | null {
  if (!stored || typeof stored !== 'object') return null
  const items = (stored as { items?: unknown }).items
  if (!Array.isArray(items) || !items.every(isItem)) return null
  return validateScheduleTemplate(items).length === 0 ? items : null
}

export function instantiateScheduleTemplate(items: readonly ScheduleTemplateItem[], start: CalendarDate, cal: WorkCalendar): ImportPlan {
  const byKey = new Map(items.map((it) => [it.key, it]))
  const links = items.flatMap((it) => it.after.map((a) => ({ fromKey: a.key, toKey: it.key, type: a.type, lagDays: a.lagDays })))
  const topo = topoOrder(items.map((it) => it.key), links.map((l) => ({ predecessorId: l.fromKey, successorId: l.toKey, type: l.type, lagDays: l.lagDays })))
  if (!topo.ok) throw new Error('The template has a loop')
  const placed = new Map<string, { start: CalendarDate; end: CalendarDate }>()
  // FS: next unit after the predecessor's end, plus lag. Units follow the calendar's mode.
  const after = (d: CalendarDate, n: number) => (cal.mode === 'working' ? shiftDate(cal, d, n) : addCalendarDays(d, n))
  const startForFinish = (finish: CalendarDate, days: number) => after(finish, -(days - 1))
  for (const key of topo.order) {
    const it = byKey.get(key)!
    const days = it.isMilestone ? 1 : it.durationDays
    let s = after(start, it.offsetDays)
    if (cal.mode === 'working') s = nextWorkingDate(cal, s)
    for (const a of it.after) {
      const p = placed.get(a.key)!
      const cand =
        a.type === 'FS' ? after(p.end, 1 + a.lagDays)
          : a.type === 'SS' ? after(p.start, a.lagDays)
            : a.type === 'FF' ? startForFinish(after(p.end, a.lagDays), days)
              : startForFinish(after(p.start, a.lagDays), days)
      if (cand > s) s = cand
    }
    if (cal.mode === 'working') s = nextWorkingDate(cal, s)
    placed.set(key, { start: s, end: it.isMilestone ? s : endForDuration(cal, s, it.durationDays) })
  }
  const tasks: PlannedTask[] = items.map((it) => ({
    key: it.key, sourceRow: null, name: it.name, category: it.category, zone: it.zone,
    start: placed.get(it.key)!.start, end: placed.get(it.key)!.end, isMilestone: it.isMilestone,
    progress: 0, status: 'not_started', colour: null, ownerHint: null, description: '', segments: [],
  }))
  return { tasks, links }
}
```

Note on the milestone FS rule: a milestone placed `after(p.end, 1)` sits on the next unit after its predecessor's last day, which is exactly `S_m = F_p` in the CPM units — the test asserts zero violations in both modes.

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/template.test.ts`
Expected: PASS (7 tests). If a "breaks no link" test fails in working mode, print `cpm.violations` and fix `instantiateScheduleTemplate`, not the test.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/schedule/import/plan.ts packages/shared/src/solar/schedule/template.ts packages/shared/src/solar/schedule/template.test.ts
git commit -m "feat(solar-schedule): import plan model + standard solar programme template

The seeded programme is forward-scheduled and proven to break no link in
either duration mode.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 7: Import parsers — CSV, MS Project XML, table mapping

**Files:**
- Create: `packages/shared/src/solar/schedule/import/csv.ts`, `import/mspdi.ts`, `import/table.ts`
- Create: `packages/shared/src/solar/schedule/import/import.test.ts`

Spec §14.1 Import: "CSV / XLSX / MS Project XML: column mapping, preview, validation (dates, cycles), commit". CSV and XLSX both become a `string[][]` table (XLSX is read server-side with exceljs in Task 18 — it produces the same table), then `guessImportMapping` + `mapImportTable`. MS Project XML (MSPDI) has fixed semantics and needs no mapping. **Predecessors are written like MS Project: `3FS+2d, 5SS`, where the number is the task's position among the file's task rows (blank rows do not count).** Task 19's XLSX export writes the same `#` numbering, so export → import round-trips. No XML dependency exists in the repo (checked: no fast-xml-parser/xmldom), and MSPDI is regular, so a small tag reader suffices; it never evaluates entities beyond the five XML ones and numeric references.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/import/import.test.ts`:
```ts
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { parseCsvText } from './csv'
import { parseMsProjectXml, isMsProjectXml } from './mspdi'
import { guessImportMapping, mapImportTable, parseLooseDate, parsePredecessors, parseProgress } from './table'
import { validateImportPlan } from './plan'
import { makeWorkCalendar } from '../calendar'

const cal = makeWorkCalendar('calendar')

describe('parseCsvText', () => {
  it('handles quotes, embedded commas and newlines, CRLF and a BOM', () => {
    expect(parseCsvText('﻿Task,Start\r\n"Install, roof A","2026-10-01"\r\n"Line1\nLine2",x\r\n'))
      .toEqual([['Task', 'Start'], ['Install, roof A', '2026-10-01'], ['Line1\nLine2', 'x']])
  })
  it('detects a semicolon delimiter (SA Excel exports)', () => {
    expect(parseCsvText('Task;Start\nA;2026-10-01')).toEqual([['Task', 'Start'], ['A', '2026-10-01']])
  })
  it('keeps escaped quotes and drops trailing blank lines', () => {
    expect(parseCsvText('a\n"say ""hi"""\n\n\n')).toEqual([['a'], ['say "hi"']])
  })
})

describe('parseLooseDate', () => {
  it('reads ISO, day-first SA dates, month names and Excel serials — never month-first', () => {
    expect(parseLooseDate('2026-10-01')).toBe('2026-10-01')
    expect(parseLooseDate('2026-10-01T08:00:00')).toBe('2026-10-01')
    expect(parseLooseDate('01/10/2026')).toBe('2026-10-01')
    expect(parseLooseDate('1.10.2026')).toBe('2026-10-01')
    expect(parseLooseDate('1 Oct 2026')).toBe('2026-10-01')
    expect(parseLooseDate('1 October 2026')).toBe('2026-10-01')
    expect(parseLooseDate('46296')).toBe('2026-10-01')
    expect(parseLooseDate('31/02/2026')).toBeNull()
    expect(parseLooseDate('soon')).toBeNull()
  })
})

describe('cell parsers', () => {
  it('progress as percent, fraction or number', () => {
    expect(parseProgress('50%')).toBe(50)
    expect(parseProgress('0.25')).toBe(25)
    expect(parseProgress('75')).toBe(75)
    expect(parseProgress('')).toBe(0)
    expect(parseProgress('lots')).toBeNull()
  })
  it('predecessors like MS Project', () => {
    expect(parsePredecessors('3FS+2d, 5SS; 7')).toEqual([
      { position: 3, type: 'FS', lagDays: 2 }, { position: 5, type: 'SS', lagDays: 0 }, { position: 7, type: 'FS', lagDays: 0 },
    ])
    expect(parsePredecessors('2FF-1')).toEqual([{ position: 2, type: 'FF', lagDays: -1 }])
    expect(parsePredecessors('')).toEqual([])
    expect(parsePredecessors('after design')).toBeNull()
  })
})

describe('guessImportMapping + mapImportTable', () => {
  const rows = [
    ['#', 'Task', 'Category', 'Zone', 'Start', 'End', 'Duration', 'Owner', 'Progress', 'Status', 'Milestone', 'Predecessors', 'Notes', 'Colour'],
    ['1', 'Design', 'Design', '', '2026-10-01', '2026-10-05', '', 'ann@example.com', '100%', '', '', '', 'First', '#EF4444'],
    ['', '', '', '', '', '', '', '', '', '', '', '', '', ''],
    ['2', 'Install', 'Installation', 'Roof A', '06/10/2026', '', '3', 'Bob', '', 'in progress', '', '1FS', '', ''],
    ['3', 'Go live', 'Handover', '', '2026-10-12', '', '', '', '', '', 'yes', '2FS+1d', '', ''],
  ]
  it('maps synonyms, ignores the # column', () => {
    const m = guessImportMapping(rows[0])
    expect(m).toMatchObject({ name: 1, category: 2, zone: 3, start: 4, end: 5, duration: 6, owner: 7, progress: 8, status: 9, milestone: 10, predecessors: 11, notes: 12, colour: 13 })
  })
  it('builds a valid plan: duration → end, progress 100 → done, milestone, links by position', () => {
    const { plan, issues } = mapImportTable(rows, guessImportMapping(rows[0]), cal)
    expect(issues).toEqual([])
    expect(plan.tasks.map((t) => [t.key, t.name, t.start, t.end, t.status, t.isMilestone])).toEqual([
      ['p1', 'Design', '2026-10-01', '2026-10-05', 'done', false],
      ['p2', 'Install', '2026-10-06', '2026-10-08', 'in_progress', false],
      ['p3', 'Go live', '2026-10-12', '2026-10-12', 'not_started', true],
    ])
    expect(plan.tasks[0]).toMatchObject({ colour: '#ef4444', ownerHint: 'ann@example.com', description: 'First', progress: 100, sourceRow: 2 })
    expect(plan.links).toEqual([
      { fromKey: 'p1', toKey: 'p2', type: 'FS', lagDays: 0 },
      { fromKey: 'p2', toKey: 'p3', type: 'FS', lagDays: 1 },
    ])
    expect(validateImportPlan(plan)).toEqual([])
  })
  it('reports bad rows by spreadsheet row, and a missing name mapping', () => {
    const bad = [['Task', 'Start', 'End', 'Predecessors'], ['A', 'someday', '', ''], ['B', '2026-10-05', '2026-10-01', '9']]
    const { issues } = mapImportTable(bad, guessImportMapping(bad[0]), cal)
    expect(issues).toEqual([
      { row: 2, message: 'Row 2: "someday" is not a date. Use 2026-10-01 or 01/10/2026.' },
      { row: 3, message: 'Row 3: predecessor 9 is not a task in this file.' },
    ])
    expect(mapImportTable(bad, { ...guessImportMapping(bad[0]), name: null }, cal).issues)
      .toEqual([{ row: null, message: 'Choose which column holds the task name.' }])
  })
  it('validateImportPlan finds a loop created by predecessors', () => {
    const loop = [['Task', 'Start', 'End', 'Predecessors'], ['A', '2026-10-01', '2026-10-02', '2'], ['B', '2026-10-03', '2026-10-04', '1']]
    const { plan } = mapImportTable(loop, guessImportMapping(loop[0]), cal)
    // A's predecessor is B (link p2→p1) and B's is A (p1→p2); the loop is reported in link direction.
    expect(validateImportPlan(plan)).toEqual([{ row: null, message: 'These tasks depend on each other in a loop: B → A → B.' }])
  })
})

const MSPDI = `<?xml version="1.0" encoding="UTF-8"?>
<Project xmlns="http://schemas.microsoft.com/project">
 <Tasks>
  <Task><UID>0</UID><ID>0</ID><Name>Project summary</Name><Summary>1</Summary><OutlineLevel>0</OutlineLevel></Task>
  <Task><UID>1</UID><ID>1</ID><Name>Design &amp; approvals</Name><Summary>1</Summary><OutlineLevel>1</OutlineLevel></Task>
  <Task><UID>2</UID><ID>2</ID><Name>Detailed design</Name><OutlineLevel>2</OutlineLevel><Start>2026-10-01T08:00:00</Start><Finish>2026-10-05T17:00:00</Finish><PercentComplete>40</PercentComplete><Notes>Ω check</Notes></Task>
  <Task><UID>3</UID><ID>3</ID><Name>SSEG submitted</Name><OutlineLevel>2</OutlineLevel><Start>2026-10-06T08:00:00</Start><Finish>2026-10-06T08:00:00</Finish><Milestone>1</Milestone>
   <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>1</Type><LinkLag>9600</LinkLag><LagFormat>7</LagFormat></PredecessorLink></Task>
  <Task><UID>4</UID><ID>4</ID><Name>Install</Name><OutlineLevel>1</OutlineLevel><Start>2026-10-07T08:00:00</Start><Finish>2026-10-09T17:00:00</Finish><PercentComplete>100</PercentComplete>
   <PredecessorLink><PredecessorUID>2</PredecessorUID><Type>3</Type></PredecessorLink>
   <PredecessorLink><PredecessorUID>1</PredecessorUID><Type>1</Type></PredecessorLink></Task>
 </Tasks>
</Project>`

describe('parseMsProjectXml', () => {
  it('detects MSPDI', () => {
    expect(isMsProjectXml(MSPDI)).toBe(true)
    expect(isMsProjectXml('Task,Start')).toBe(false)
  })
  it('skips summaries, keeps outline names as category, maps link types and lag, never shifts dates', () => {
    const { plan, issues } = parseMsProjectXml(MSPDI)
    expect(plan.tasks.map((t) => [t.key, t.name, t.category, t.start, t.end, t.isMilestone, t.status, t.progress])).toEqual([
      ['uid:2', 'Detailed design', 'Design & approvals', '2026-10-01', '2026-10-05', false, 'in_progress', 40],
      ['uid:3', 'SSEG submitted', 'Design & approvals', '2026-10-06', '2026-10-06', true, 'not_started', 0],
      ['uid:4', 'Install', '', '2026-10-07', '2026-10-09', false, 'done', 100],
    ])
    expect(plan.tasks[0].description).toBe('Ω check')
    expect(plan.links).toEqual([
      { fromKey: 'uid:2', toKey: 'uid:3', type: 'FS', lagDays: 2 },
      { fromKey: 'uid:2', toKey: 'uid:4', type: 'SS', lagDays: 0 },
    ])
    expect(issues).toEqual([{ row: null, message: '"Install" depends on a summary task in Project; that link was left out.' }])
    expect(validateImportPlan(plan)).toEqual([])
  })
})
```

Check `46296`: day number of 2026-10-01 is 20727; 20727 + 25569 = 46296 (Excel epoch 1899-12-30). Keep that arithmetic in the code comment.

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/import/import.test.ts`
Expected: FAIL — unresolved imports.

- [ ] **Step 3: Implement `csv.ts`**

`packages/shared/src/solar/schedule/import/csv.ts`:
```ts
/** RFC 4180 CSV → rows of strings. Comma or semicolon (detected on the header line), quotes, CRLF, BOM. */
export function parseCsvText(text: string): string[][] {
  const src = text.replace(/^﻿/, '')
  const header = src.split(/\r?\n/, 1)[0] ?? ''
  const delim = (header.match(/;/g)?.length ?? 0) > (header.match(/,/g)?.length ?? 0) ? ';' : ','
  const rows: string[][] = []
  let row: string[] = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < src.length; i++) {
    const ch = src[i]
    if (quoted) {
      if (ch === '"' && src[i + 1] === '"') { cell += '"'; i++ }
      else if (ch === '"') quoted = false
      else cell += ch
      continue
    }
    if (ch === '"') quoted = true
    else if (ch === delim) { row.push(cell); cell = '' }
    else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && src[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length > 0) { row.push(cell); rows.push(row) }
  while (rows.length && rows[rows.length - 1].every((c) => c.trim() === '')) rows.pop()
  return rows
}
```

- [ ] **Step 4: Implement `table.ts`**

`packages/shared/src/solar/schedule/import/table.ts`:
```ts
/** A spreadsheet-shaped table (CSV or XLSX) → ImportPlan, through a column mapping the user can correct. */
import { fromDayNumber, isCalendarDate, type CalendarDate } from '../dates'
import { endForDuration, type WorkCalendar } from '../calendar'
import { isLinkType, type LinkType } from '../graph'
import type { GanttStatus } from '../status'
import type { ImportIssue, ImportPlan, PlannedLink, PlannedTask } from './plan'

export const IMPORT_FIELDS = [
  'name', 'category', 'zone', 'start', 'end', 'duration', 'owner', 'progress', 'status', 'milestone', 'predecessors', 'notes', 'colour',
] as const
export type ImportField = (typeof IMPORT_FIELDS)[number]
export type ImportMapping = Record<ImportField, number | null>

export const IMPORT_FIELD_LABELS: Record<ImportField, string> = {
  name: 'Task name', category: 'Category', zone: 'Zone', start: 'Start date', end: 'End date', duration: 'Duration (days)',
  owner: 'Owner', progress: 'Progress %', status: 'Status', milestone: 'Milestone', predecessors: 'Predecessors',
  notes: 'Notes', colour: 'Colour',
}

const SYNONYMS: Record<ImportField, string[]> = {
  name: ['task', 'task name', 'name', 'activity', 'description of work'],
  category: ['category', 'phase', 'group'],
  zone: ['zone', 'area', 'location'],
  start: ['start', 'start date', 'begin'],
  end: ['end', 'end date', 'finish', 'finish date'],
  duration: ['duration', 'days', 'duration (days)'],
  owner: ['owner', 'assigned to', 'resource', 'resource names', 'responsible'],
  progress: ['progress', 'progress (%)', '% complete', 'percent complete', 'complete'],
  status: ['status'],
  milestone: ['milestone'],
  predecessors: ['predecessors', 'depends on', 'dependencies'],
  notes: ['notes', 'comments', 'remarks'],
  colour: ['colour', 'color'],
}

export function guessImportMapping(header: readonly string[]): ImportMapping {
  const norm = header.map((h) => h.trim().toLowerCase())
  const out = Object.fromEntries(IMPORT_FIELDS.map((f) => [f, null])) as ImportMapping
  for (const f of IMPORT_FIELDS) {
    const i = norm.findIndex((h) => SYNONYMS[f].includes(h))
    if (i !== -1) out[f] = i
  }
  return out
}

const MONTHS = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 'jul', 'aug', 'sep', 'oct', 'nov', 'dec']
const EXCEL_EPOCH_OFFSET = 25569 // days from 1899-12-30 (Excel day 0) to 1970-01-01

function ymd(y: number, m: number, d: number): CalendarDate | null {
  const s = `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`
  return isCalendarDate(s) ? s : null
}

/** ISO, day-first (SA) numeric, "1 Oct 2026", or an Excel serial. Month-first US dates are NOT read. */
export function parseLooseDate(raw: string): CalendarDate | null {
  const s = raw.trim()
  let m = /^(\d{4})-(\d{2})-(\d{2})(?:[T ].*)?$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{4})\/(\d{1,2})\/(\d{1,2})$/.exec(s)
  if (m) return ymd(+m[1], +m[2], +m[3])
  m = /^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})$/.exec(s)
  if (m) return ymd(+m[3], +m[2], +m[1])
  m = /^(\d{1,2})\s+([A-Za-z]+)\s+(\d{4})$/.exec(s)
  if (m) {
    const mi = MONTHS.indexOf(m[2].slice(0, 3).toLowerCase())
    return mi === -1 ? null : ymd(+m[3], mi + 1, +m[1])
  }
  if (/^\d{5}$/.test(s)) {
    const serial = Number(s)
    if (serial >= 20000 && serial <= 80000) return fromDayNumber(serial - EXCEL_EPOCH_OFFSET)
  }
  return null
}

export function parseProgress(raw: string): number | null {
  const s = raw.trim().replace('%', '')
  if (s === '') return 0
  const n = Number(s)
  if (!Number.isFinite(n)) return null
  const pct = !raw.includes('%') && n > 0 && n <= 1 && s.includes('.') ? n * 100 : n
  return Math.min(100, Math.max(0, Math.round(pct)))
}

export function parsePredecessors(raw: string): Array<{ position: number; type: LinkType; lagDays: number }> | null {
  const s = raw.trim()
  if (!s) return []
  const out: Array<{ position: number; type: LinkType; lagDays: number }> = []
  for (const part of s.split(/[,;]/)) {
    const m = /^(\d+)\s*(FS|SS|FF|SF)?\s*(?:([+-])\s*(\d+)\s*(?:d|days?|wd)?)?$/i.exec(part.trim())
    if (!m) return null
    const type = (m[2] ?? 'FS').toUpperCase()
    if (!isLinkType(type)) return null
    out.push({ position: Number(m[1]), type, lagDays: m[4] ? Number(m[4]) * (m[3] === '-' ? -1 : 1) : 0 })
  }
  return out
}

function parseStatusCell(raw: string): GanttStatus | null {
  const s = raw.trim().toLowerCase().replace(/[_-]/g, ' ')
  if (!s) return null
  if (['done', 'complete', 'completed', 'finished'].includes(s)) return 'done'
  if (['in progress', 'started', 'underway', 'busy'].includes(s)) return 'in_progress'
  if (['not started', 'todo', 'to do', 'planned', 'pending'].includes(s)) return 'not_started'
  return null
}

const truthy = (s: string) => ['yes', 'y', 'true', '1', 'x'].includes(s.trim().toLowerCase())

export function mapImportTable(
  rows: readonly string[][],
  mapping: ImportMapping,
  cal: WorkCalendar,
): { plan: ImportPlan; issues: ImportIssue[] } {
  if (mapping.name === null) return { plan: { tasks: [], links: [] }, issues: [{ row: null, message: 'Choose which column holds the task name.' }] }
  if (mapping.start === null) return { plan: { tasks: [], links: [] }, issues: [{ row: null, message: 'Choose which column holds the start date.' }] }
  const cell = (r: readonly string[], f: ImportField) => (mapping[f] === null ? '' : (r[mapping[f] as number] ?? '').trim())
  const issues: ImportIssue[] = []
  const tasks: PlannedTask[] = []
  const pending: Array<{ key: string; row: number; raw: string }> = []
  let position = 0
  rows.forEach((r, i) => {
    if (i === 0 || r.every((c) => c.trim() === '')) return
    const rowNo = i + 1
    position++
    const key = `p${position}`
    const name = cell(r, 'name')
    const startRaw = cell(r, 'start')
    const start = parseLooseDate(startRaw)
    if (!name) { issues.push({ row: rowNo, message: `Row ${rowNo}: the task has no name.` }); return }
    if (!start) { issues.push({ row: rowNo, message: `Row ${rowNo}: "${startRaw}" is not a date. Use 2026-10-01 or 01/10/2026.` }); return }
    const durRaw = cell(r, 'duration')
    const isMilestone = truthy(cell(r, 'milestone')) || durRaw === '0'
    let end: CalendarDate | null = start
    if (!isMilestone) {
      const endRaw = cell(r, 'end')
      if (endRaw) {
        end = parseLooseDate(endRaw)
        if (!end) { issues.push({ row: rowNo, message: `Row ${rowNo}: "${endRaw}" is not a date. Use 2026-10-01 or 01/10/2026.` }); return }
      } else if (durRaw) {
        const d = Number(durRaw)
        if (!Number.isInteger(d) || d < 1) { issues.push({ row: rowNo, message: `Row ${rowNo}: duration "${durRaw}" must be a whole number of days.` }); return }
        end = endForDuration(cal, start, d)
      }
    }
    const progress = parseProgress(cell(r, 'progress'))
    if (progress === null) { issues.push({ row: rowNo, message: `Row ${rowNo}: progress "${cell(r, 'progress')}" is not a percentage.` }); return }
    const status = parseStatusCell(cell(r, 'status')) ?? (progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started')
    const colourRaw = cell(r, 'colour').toLowerCase()
    tasks.push({
      key, sourceRow: rowNo, name, category: cell(r, 'category'), zone: cell(r, 'zone'),
      start, end: end as CalendarDate, isMilestone, progress: status === 'done' ? 100 : progress, status,
      colour: /^#[0-9a-f]{6}$/.test(colourRaw) ? colourRaw : null,
      ownerHint: cell(r, 'owner') || null, description: cell(r, 'notes'), segments: [],
    })
    const pred = cell(r, 'predecessors')
    if (pred) pending.push({ key, row: rowNo, raw: pred })
  })
  const keys = new Set(tasks.map((t) => t.key))
  const links: PlannedLink[] = []
  for (const p of pending) {
    const parsed = parsePredecessors(p.raw)
    if (!parsed) { issues.push({ row: p.row, message: `Row ${p.row}: predecessors "${p.raw}" should look like 3FS+2d, 5SS.` }); continue }
    for (const x of parsed) {
      const from = `p${x.position}`
      if (!keys.has(from)) { issues.push({ row: p.row, message: `Row ${p.row}: predecessor ${x.position} is not a task in this file.` }); continue }
      links.push({ fromKey: from, toKey: p.key, type: x.type, lagDays: x.lagDays })
    }
  }
  return { plan: { tasks, links }, issues }
}
```

- [ ] **Step 5: Implement `mspdi.ts`**

`packages/shared/src/solar/schedule/import/mspdi.ts`:
```ts
/**
 * Microsoft Project XML (MSPDI) → ImportPlan. Summary tasks are not imported;
 * their names become the category (outline level 1) and zone (level 2) of the
 * tasks beneath them. Dates are the first 10 characters of <Start>/<Finish>
 * (a local date-time in the file) — no time-zone conversion. Link <Type>:
 * 0 FF, 1 FS, 2 SF, 3 SS. <LinkLag> is in tenths of a minute: 4800 per
 * 8-hour working day, 14400 per elapsed day (LagFormat 8/elapsed forms).
 */
import { isCalendarDate } from '../dates'
import type { LinkType } from '../graph'
import type { ImportIssue, ImportPlan, PlannedLink, PlannedTask } from './plan'

const TYPE: Record<string, LinkType> = { '0': 'FF', '1': 'FS', '2': 'SF', '3': 'SS' }
const ELAPSED_FORMATS = new Set(['4', '6', '8', '10', '12', '20', '36', '38', '40', '42', '44'])

export function isMsProjectXml(text: string): boolean {
  return /<Project[^>]*xmlns="http:\/\/schemas\.microsoft\.com\/project"/.test(text)
}

function decodeXml(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'")
    .replace(/&amp;/g, '&')
}

function tag(block: string, name: string): string | null {
  const m = new RegExp(`<${name}>([\\s\\S]*?)</${name}>`).exec(block)
  return m ? decodeXml(m[1].trim()) : null
}

export function parseMsProjectXml(xml: string): { plan: ImportPlan; issues: ImportIssue[] } {
  const issues: ImportIssue[] = []
  const tasks: PlannedTask[] = []
  const summaries = new Set<string>()
  const outline: string[] = []
  const rawLinks: Array<{ toUid: string; toName: string; fromUid: string; type: LinkType; lagDays: number }> = []
  for (const m of xml.matchAll(/<Task>([\s\S]*?)<\/Task>/g)) {
    const b = m[1]
    const uid = tag(b, 'UID') ?? ''
    const name = tag(b, 'Name') ?? ''
    const level = Number(tag(b, 'OutlineLevel') ?? '1')
    if (uid === '0' || tag(b, 'IsNull') === '1') continue
    if (tag(b, 'Summary') === '1') {
      summaries.add(uid)
      outline[level] = name
      outline.length = level + 1
      continue
    }
    if (!name) continue
    const start = (tag(b, 'Start') ?? '').slice(0, 10)
    const finish = (tag(b, 'Finish') ?? '').slice(0, 10)
    if (!isCalendarDate(start) || !isCalendarDate(finish)) {
      issues.push({ row: null, message: `"${name}" has no usable start or finish date in the Project file.` })
      continue
    }
    const isMilestone = tag(b, 'Milestone') === '1'
    const progress = Math.min(100, Math.max(0, Math.round(Number(tag(b, 'PercentComplete') ?? '0') || 0)))
    tasks.push({
      key: `uid:${uid}`, sourceRow: null, name,
      category: level >= 2 ? outline[1] ?? '' : '', zone: level >= 3 ? outline[2] ?? '' : '',
      start, end: isMilestone ? start : finish, isMilestone, progress,
      status: progress >= 100 ? 'done' : progress > 0 ? 'in_progress' : 'not_started',
      colour: null, ownerHint: null, description: tag(b, 'Notes') ?? '', segments: [],
    })
    for (const l of b.matchAll(/<PredecessorLink>([\s\S]*?)<\/PredecessorLink>/g)) {
      const fromUid = tag(l[1], 'PredecessorUID') ?? ''
      const lag = Number(tag(l[1], 'LinkLag') ?? '0') || 0
      const per = ELAPSED_FORMATS.has(tag(l[1], 'LagFormat') ?? '') ? 14400 : 4800
      rawLinks.push({ toUid: uid, toName: name, fromUid, type: TYPE[tag(l[1], 'Type') ?? '1'] ?? 'FS', lagDays: Math.round(lag / per) })
    }
  }
  const known = new Set(tasks.map((t) => t.key))
  const links: PlannedLink[] = []
  for (const r of rawLinks) {
    if (summaries.has(r.fromUid)) {
      issues.push({ row: null, message: `"${r.toName}" depends on a summary task in Project; that link was left out.` })
      continue
    }
    if (!known.has(`uid:${r.fromUid}`)) continue
    links.push({ fromKey: `uid:${r.fromUid}`, toKey: `uid:${r.toUid}`, type: r.type, lagDays: r.lagDays })
  }
  return { plan: { tasks, links }, issues }
}
```

- [ ] **Step 6: Run — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/import/import.test.ts`
Expected: PASS (11 tests).

- [ ] **Step 7: Commit**

```bash
git add packages/shared/src/solar/schedule/import
git commit -m "feat(solar-schedule): CSV, table-mapping and MS Project XML import parsers

Day-first SA dates and Excel serials, MS-Project-style predecessors by task
position, loop detection with task names, no time-zone conversion.

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 8: Calendar export — `ics.ts`

**Files:**
- Create: `packages/shared/src/solar/schedule/ics.ts`, `ics.test.ts`

Fixes every WM ICS defect (as-is/06 B.5.5): no VTODO `STATUS` values on a VEVENT, no fabricated `ORGANIZER`, a real UTC `DTSTAMP`, 75-octet line folding, a real UID domain. All-day events: `DTEND` is exclusive (end + 1).

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/ics.test.ts`:
```ts
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { buildScheduleIcs, type IcsTask } from './ics'

const now = new Date(Date.UTC(2026, 8, 28, 21, 30, 0))
const task = (over: Partial<IcsTask> = {}): IcsTask => ({
  id: 't1', ref: 'SOLAR-1', name: 'Install modules', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, description: '', status: 'in_progress', ownerName: 'Ann Smith', ...over,
})
const unfold = (s: string) => s.replace(/\r\n /g, '')

describe('buildScheduleIcs', () => {
  const ics = buildScheduleIcs({ calendarName: 'KINGSWALK, solar', tasks: [task(), task({ id: 'm', ref: 'SOLAR-2', name: 'Go live', start: '2026-10-12', end: '2026-10-12', isMilestone: true })], now })
  it('all-day events with an exclusive DTEND, dates untouched in SAST', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20261006\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013\r\n')
  })
  it('real UTC DTSTAMP, stable UID, no VTODO status, no invented organiser', () => {
    expect(ics).toContain('DTSTAMP:20260928T213000Z\r\n')
    expect(ics).toContain('UID:solar-task-t1@e-site.live\r\n')
    expect(ics).not.toMatch(/^STATUS:/m)
    expect(ics).not.toContain('ORGANIZER')
    expect(ics).toContain('SUMMARY:SOLAR-2 Milestone: Go live\r\n')
  })
  it('escapes text and names the calendar', () => {
    expect(ics).toContain('X-WR-CALNAME:KINGSWALK\\, solar Schedule\r\n')
    const x = buildScheduleIcs({ calendarName: 'P', tasks: [task({ name: 'a, b; c\\d', description: 'line1\nline2' })], now })
    expect(unfold(x)).toContain('SUMMARY:SOLAR-1 a\\, b\\; c\\\\d')
    expect(unfold(x)).toContain('\\nline1\\nline2')
  })
  it('folds every physical line to at most 75 octets without splitting a character', () => {
    const long = 'Ω'.repeat(60) + ' commissioning of the rooftop array'
    const x = buildScheduleIcs({ calendarName: 'P', tasks: [task({ name: long })], now })
    for (const line of x.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(unfold(x)).toContain(`SUMMARY:SOLAR-1 ${long}`)
    expect(x).not.toContain('\uFFFD')
  })
  it('CRLF only, and ends with CRLF', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/ics.test.ts`
Expected: FAIL — cannot resolve `./ics`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/schedule/ics.ts`:
```ts
/** RFC 5545 calendar of the schedule (spec §14.1 Export → calendar .ics). Plain text, no dependency. */
import { addCalendarDays, type CalendarDate } from './dates'
import { GANTT_STATUS_LABELS, type GanttStatus } from './status'

export interface IcsTask {
  id: string
  ref: string
  name: string
  start: CalendarDate
  end: CalendarDate
  isMilestone: boolean
  description: string
  status: GanttStatus
  ownerName: string | null
}

const esc = (s: string) => s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n')
const compact = (d: CalendarDate) => d.replace(/-/g, '')
const p2 = (n: number) => String(n).padStart(2, '0')

function stamp(now: Date): string {
  return `${now.getUTCFullYear()}${p2(now.getUTCMonth() + 1)}${p2(now.getUTCDate())}T${p2(now.getUTCHours())}${p2(now.getUTCMinutes())}${p2(now.getUTCSeconds())}Z`
}

/** Fold to 75 octets per physical line (continuations start with one space), never inside a UTF-8 sequence. */
function fold(line: string): string {
  const enc = new TextEncoder()
  const out: string[] = []
  let cur = ''
  let bytes = 0
  let limit = 75
  for (const ch of line) {
    const n = enc.encode(ch).length
    if (bytes + n > limit) {
      out.push(cur)
      cur = ' '
      bytes = 1
      limit = 75
    }
    cur += ch
    bytes += n
  }
  out.push(cur)
  return out.join('\r\n')
}

export function buildScheduleIcs(input: {
  calendarName: string
  tasks: readonly IcsTask[]
  now: Date
  uidDomain?: string
}): string {
  const domain = input.uidDomain ?? 'e-site.live'
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//E-Site//Solar schedule//EN', 'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(`${input.calendarName} Schedule`)}`,
  ]
  for (const t of input.tasks) {
    const details = [
      t.ownerName ? `Owner: ${t.ownerName}` : null,
      `Status: ${GANTT_STATUS_LABELS[t.status]}`,
      t.description || null,
    ].filter((x): x is string => x !== null).join('\n')
    lines.push(
      'BEGIN:VEVENT',
      `UID:solar-task-${t.id}@${domain}`,
      `DTSTAMP:${stamp(input.now)}`,
      `DTSTART;VALUE=DATE:${compact(t.start)}`,
      `DTEND;VALUE=DATE:${compact(addCalendarDays(t.isMilestone ? t.start : t.end, 1))}`,
      `SUMMARY:${esc(`${t.ref} ${t.isMilestone ? 'Milestone: ' : ''}${t.name}`)}`,
      `DESCRIPTION:${esc(details)}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    )
  }
  lines.push('END:VCALENDAR')
  return lines.map(fold).join('\r\n') + '\r\n'
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/ics.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/schedule/ics.ts packages/shared/src/solar/schedule/ics.test.ts
git commit -m "feat(solar-schedule): RFC 5545 export — folded, escaped, UTC stamp, no VTODO status

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 9: Gantt geometry — `layout.ts`, and the barrel

**Files:**
- Create: `packages/shared/src/solar/schedule/layout.ts`, `layout.test.ts`, `index.ts`
- Modify: `packages/shared/src/solar/index.ts` (add one line)

**Chart technology decision: Konva, with all geometry here.** E-Site already renders drawings with react-konva (`MarkupCanvas.tsx`, `RouteCanvas.tsx`), `stage.toDataURL()` gives the PNG export for free, and a canvas holds hundreds of bars, weekend/holiday bands and link paths without a DOM node each. Konva cannot render under jsdom (the known gap on `RouteLayer`/`RouteCanvas`), so the component is kept thin: every coordinate it draws comes from `layoutGantt()`, which is pure and tested here. The row list (checkboxes, drag handles, labels, keyboard focus) stays DOM for accessibility and testability, and both read the same `ScheduleRow[]`, so names and bars cannot drift apart.

- [ ] **Step 1: Write the failing test**

`packages/shared/src/solar/schedule/layout.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { layoutGantt, xOfDate, dateAtX, GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type GanttLayoutInput } from './layout'
import { buildScheduleRows, type ScheduleTaskView } from './rows'
import { makeWorkCalendar, saHolidaySet } from './calendar'

const task = (id: string, start: string, end: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: id, ref: id, name: id, category: 'C', zone: '', start, end, isMilestone: false, status: 'not_started',
  awaitingSignOff: false, progress: 0, colour: '#3b82f6', ownerId: 'u', ownerName: 'U', sortOrder: 1, description: '',
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
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/schedule/layout.test.ts`
Expected: FAIL — cannot resolve `./layout`.

- [ ] **Step 3: Implement**

`packages/shared/src/solar/schedule/layout.ts`:
```ts
/**
 * Gantt geometry (spec §14.2). Pure: the Konva component draws exactly what
 * this returns. Rows come from buildScheduleRows, so a group header is a row
 * here as in the list. Bars snap to whole days: a task covers
 * [start, end + 1 day) in x.
 */
import { addCalendarDays, daysBetween, formatCalendarDate, maxCalendarDate, minCalendarDate, weekdayOf, type CalendarDate } from './dates'
import { isWeekendDate, type WorkCalendar } from './calendar'
import { linkKey, type ScheduleLink } from './graph'
import type { ScheduleRow } from './rows'

export const SCHEDULE_ZOOMS = ['day', 'week', 'month'] as const
export type ScheduleZoom = (typeof SCHEDULE_ZOOMS)[number]
export const GANTT_DAY_WIDTH: Record<ScheduleZoom, number> = { day: 36, week: 14, month: 4 }
export const GANTT_ROW_HEIGHT = 28
export const GANTT_HEADER_HEIGHT = 40
export const GANTT_MAX_WIDTH = 16_000
const BAR_PAD = 6

export interface GanttBar {
  taskId: string
  rowIndex: number
  kind: 'task' | 'milestone' | 'segment'
  segmentIndex: number | null
  x: number
  y: number
  w: number
  h: number
  colour: string
  progress: number
  critical: boolean
}
export interface GanttBaselineBar { taskId: string; x: number; y: number; w: number }
export interface GanttLinkPath { key: string; points: number[]; critical: boolean }
export interface GanttShade { x: number; w: number; kind: 'weekend' | 'holiday' }
export interface GanttTick { x: number; label: string; major: boolean }

export interface GanttLayout {
  rangeStart: CalendarDate
  rangeEnd: CalendarDate
  zoom: ScheduleZoom
  clamped: boolean
  dayWidth: number
  width: number
  height: number
  ticks: GanttTick[]
  shades: GanttShade[]
  todayX: number | null
  bars: GanttBar[]
  baselineBars: GanttBaselineBar[]
  links: GanttLinkPath[]
}

export interface GanttLayoutInput {
  rows: readonly ScheduleRow[]
  zoom: ScheduleZoom
  cal: WorkCalendar
  today: CalendarDate
  splitBars: boolean
  links: readonly ScheduleLink[]
  showLinks: boolean
  critical: ReadonlySet<string>
  criticalLinks: ReadonlySet<string>
  baseline: ReadonlyMap<string, { start: CalendarDate; end: CalendarDate }> | null
}

export function xOfDate(l: Pick<GanttLayout, 'rangeStart' | 'dayWidth'>, d: CalendarDate): number {
  return daysBetween(l.rangeStart, d) * l.dayWidth
}

export function dateAtX(l: Pick<GanttLayout, 'rangeStart' | 'dayWidth'>, x: number): CalendarDate {
  return addCalendarDays(l.rangeStart, Math.floor(x / l.dayWidth))
}

export function layoutGantt(input: GanttLayoutInput): GanttLayout {
  const taskRows = input.rows.flatMap((r, i) => (r.kind === 'task' ? [{ i, t: r.task }] : []))
  const dates = taskRows.flatMap(({ t }) => [t.start, t.end])
  if (input.baseline) for (const b of input.baseline.values()) dates.push(b.start, b.end)
  const lo = minCalendarDate(dates)
  const hi = maxCalendarDate(dates)
  const rangeStart = addCalendarDays(lo ?? input.today, -7)
  const rangeEnd = addCalendarDays(hi ?? input.today, lo ? 14 : 30)
  const days = daysBetween(rangeStart, rangeEnd) + 1

  let zoom = input.zoom
  let clamped = false
  while (days * GANTT_DAY_WIDTH[zoom] > GANTT_MAX_WIDTH && zoom !== 'month') {
    zoom = zoom === 'day' ? 'week' : 'month'
    clamped = true
  }
  const dw = GANTT_DAY_WIDTH[zoom]
  const geo = { rangeStart, dayWidth: dw }
  const x = (d: CalendarDate) => xOfDate(geo, d)

  const ticks: GanttTick[] = []
  const shades: GanttShade[] = []
  for (let d = rangeStart; d <= rangeEnd; d = addCalendarDays(d, 1)) {
    const wd = weekdayOf(d)
    if (zoom === 'day') ticks.push({ x: x(d), label: String(Number(d.slice(8))), major: wd === 1 })
    else if (zoom === 'week' && wd === 1) ticks.push({ x: x(d), label: formatCalendarDate(d).split(' ').slice(0, 2).join(' '), major: true })
    else if (zoom === 'month' && d.endsWith('-01')) ticks.push({ x: x(d), label: formatCalendarDate(d).split(' ').slice(1).join(' '), major: true })
    if (input.cal.holidays.has(d)) shades.push({ x: x(d), w: dw, kind: 'holiday' })
    else if (isWeekendDate(d)) shades.push({ x: x(d), w: dw, kind: 'weekend' })
  }

  const bars: GanttBar[] = []
  const baselineBars: GanttBaselineBar[] = []
  const anchors = new Map<string, { left: number; right: number; cy: number }>()
  for (const { i, t } of taskRows) {
    const top = GANTT_HEADER_HEIGHT + i * GANTT_ROW_HEIGHT
    const y = top + BAR_PAD
    const h = GANTT_ROW_HEIGHT - 2 * BAR_PAD
    const common = { taskId: t.id, rowIndex: i, y, h, colour: t.colour, progress: t.progress, critical: input.critical.has(t.id) }
    if (t.isMilestone) {
      const cx = x(t.start) + dw / 2
      bars.push({ ...common, kind: 'milestone', segmentIndex: null, x: cx, w: 0 })
      anchors.set(t.id, { left: cx, right: cx, cy: y + h / 2 })
    } else {
      if (input.splitBars && t.segments.length >= 2) {
        t.segments.forEach((s, k) => bars.push({ ...common, kind: 'segment', segmentIndex: k, x: x(s.start), w: (daysBetween(s.start, s.end) + 1) * dw }))
      } else {
        bars.push({ ...common, kind: 'task', segmentIndex: null, x: x(t.start), w: (daysBetween(t.start, t.end) + 1) * dw })
      }
      anchors.set(t.id, { left: x(t.start), right: x(t.end) + dw, cy: y + h / 2 })
    }
    const b = input.baseline?.get(t.id)
    if (b) baselineBars.push({ taskId: t.id, x: x(b.start), y: top + GANTT_ROW_HEIGHT - 5, w: (daysBetween(b.start, b.end) + 1) * dw })
  }

  const links: GanttLinkPath[] = []
  if (input.showLinks) {
    for (const l of input.links) {
      const a = anchors.get(l.predecessorId)
      const b = anchors.get(l.successorId)
      if (!a || !b) continue
      const from = l.type[0] === 'F' ? a.right : a.left
      const to = l.type[1] === 'S' ? b.left : b.right
      const y1 = a.cy
      const y2 = b.cy
      let points: number[]
      if (l.type[1] === 'S') {
        if (to >= from + 12) points = [from, y1, from + 6, y1, from + 6, y2, to, y2]
        else {
          const yMid = y2 - GANTT_ROW_HEIGHT / 2
          points = [from, y1, from + 6, y1, from + 6, yMid, to - 6, yMid, to - 6, y2, to, y2]
        }
      } else {
        const xr = Math.max(from, to) + 6
        points = [from, y1, xr, y1, xr, y2, to, y2]
      }
      links.push({ key: linkKey(l), points, critical: input.criticalLinks.has(linkKey(l)) })
    }
  }

  const todayX = input.today >= rangeStart && input.today <= rangeEnd ? x(input.today) : null
  return {
    rangeStart, rangeEnd, zoom, clamped, dayWidth: dw, width: days * dw,
    height: GANTT_HEADER_HEIGHT + input.rows.length * GANTT_ROW_HEIGHT,
    ticks, shades, todayX, bars, baselineBars, links,
  }
}
```

- [ ] **Step 4: Barrel**

`packages/shared/src/solar/schedule/index.ts`:
```ts
export * from './dates'
export * from './calendar'
export * from './graph'
export * from './cpm'
export * from './status'
export * from './rows'
export * from './drag'
export * from './rollup'
export * from './template'
export * from './import/plan'
export * from './import/csv'
export * from './import/mspdi'
export * from './import/table'
export * from './ics'
export * from './layout'
```

In `packages/shared/src/solar/index.ts` append:
```ts
export * from './schedule'
```

- [ ] **Step 5: Run the whole schedule folder + type-check**

```bash
pnpm --filter @esite/shared exec vitest run src/solar/schedule
pnpm --filter @esite/shared type-check
```
Expected: all PASS; type-check exit 0. A `Module './schedule' has already exported a member named …` error means a name collides with an existing barrel export — rename the schedule-side symbol (prefix `schedule`) and update its importers; never remove the existing export.

- [ ] **Step 6: Commit**

```bash
git add packages/shared/src/solar/schedule/layout.ts packages/shared/src/solar/schedule/layout.test.ts packages/shared/src/solar/schedule/index.ts packages/shared/src/solar/index.ts
git commit -m "feat(solar-schedule): pure Gantt layout (aligned rows, shading, links, baseline) + barrel

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

Continue with Part 3 (`2026-09-28-solar-phase-5b-schedule-3-registry-migration.md`).
