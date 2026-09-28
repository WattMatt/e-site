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
