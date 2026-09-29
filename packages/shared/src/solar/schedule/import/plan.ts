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
/** solar.schedule_dependencies.lag_days CHECK (lag_days BETWEEN -365 AND 365), 00213. */
export const MAX_LAG_DAYS = 365

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
    if (!Number.isInteger(l.lagDays) || Math.abs(l.lagDays) > MAX_LAG_DAYS) {
      issues.push({ row: null, message: `The link from "${names.get(l.fromKey) ?? l.fromKey}" to "${names.get(l.toKey) ?? l.toKey}" has a lag of ${l.lagDays} days; a lag must be between -${MAX_LAG_DAYS} and ${MAX_LAG_DAYS} days.` })
    }
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
