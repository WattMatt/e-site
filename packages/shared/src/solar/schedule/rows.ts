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
  /** Who signs the task off (projects.work_items.gatekeeper_id); null if none. */
  gatekeeperId: string | null
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
