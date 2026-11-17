/**
 * The rows the grid and the timeline show, as one pure function of the state, the schedule,
 * the collapse set, the filters and the grouping. Both panes draw the same list, so their
 * rows line up.
 *
 * - WBS (default): the outline. With a filter on, an activity is kept when it matches, and so
 *   is every ancestor of a match, so the hierarchy still reads. A filtered view ignores
 *   collapse (a match is never hidden under a closed parent).
 * - Group by a code type: one header row per code value (sorted by value, activities with no
 *   value last), then that group's activities flat in outline order. Summaries are not listed
 *   (a group is the rollup). A header carries the value, the count, the earliest start and the
 *   latest finish of its members. A group with no members after filtering is left out.
 * - "Late or negative float" keeps an activity whose total float is negative or whose early
 *   finish falls after its deadline.
 */
import { outlineRows, type ActivityRow, type ProgrammeState, type ScheduleResult } from '@esite/shared/programme'

export interface Filters { search: string; criticalOnly: boolean; lateOrNegative: boolean; milestonesOnly: boolean }
export const NO_FILTERS: Filters = { search: '', criticalOnly: false, lateOrNegative: false, milestonesOnly: false }
export const filtersActive = (f: Filters): boolean =>
  f.search.trim() !== '' || f.criticalOnly || f.lateOrNegative || f.milestonesOnly

/** 'wbs', or a code type id. */
export type GroupBy = string
export const GROUP_BY_WBS = 'wbs'
export const groupRowId = (valueId: string | null) => `group:${valueId ?? 'none'}`

export interface ActivityDisplayRow {
  kind: 'activity'; id: string; depth: number; wbs: string; hasChildren: boolean; collapsed: boolean; activity: ActivityRow
}
export interface GroupDisplayRow {
  kind: 'group'; id: string; label: string; count: number; start: string | null; finish: string | null; collapsed: boolean
}
export type DisplayRow = ActivityDisplayRow | GroupDisplayRow

const isSummary = (a: ActivityRow) => a.type === 'summary' || a.type === 'module_summary'
const isMilestone = (a: ActivityRow) => a.type === 'start_milestone' || a.type === 'finish_milestone'

export function matchesFilters(a: ActivityRow, schedule: ScheduleResult, f: Filters): boolean {
  const s = schedule.activities.get(a.id)
  const q = f.search.trim().toLowerCase()
  if (q !== '' && !a.name.toLowerCase().includes(q) && !(a.code ?? '').toLowerCase().includes(q)) return false
  if (f.criticalOnly && s?.isCritical !== true) return false
  if (f.milestonesOnly && !isMilestone(a)) return false
  if (f.lateOrNegative) {
    const late = s !== undefined && ((s.totalFloat < 0) || (a.deadline !== null && s.earlyFinish > a.deadline))
    if (!late) return false
  }
  return true
}

export interface BuildOptions { collapsed: ReadonlySet<string>; filters: Filters; groupBy: GroupBy }

export function buildDisplayRows(state: ProgrammeState, schedule: ScheduleResult, opts: BuildOptions): DisplayRow[] {
  const byId = new Map(state.activities.map((a) => [a.id, a]))
  const filtering = filtersActive(opts.filters)
  const type = opts.groupBy !== GROUP_BY_WBS ? state.codeTypes.find((t) => t.id === opts.groupBy) : undefined

  if (!type) {
    const outline = outlineRows(state.activities, filtering ? new Set() : (opts.collapsed as Set<string>))
    let keep: Set<string> | null = null
    if (filtering) {
      keep = new Set()
      for (const r of outline) {
        const a = byId.get(r.id)
        if (!a || !matchesFilters(a, schedule, opts.filters) || keep.has(r.id)) continue
        for (let cur: string | null = r.id; cur !== null && !keep.has(cur); cur = byId.get(cur)?.parent_id ?? null) keep.add(cur)
      }
    }
    const out: DisplayRow[] = []
    for (const r of outline) {
      const a = byId.get(r.id)
      if (!a || (keep && !keep.has(r.id))) continue
      out.push({ kind: 'activity', id: r.id, depth: r.depth, wbs: r.wbs, hasChildren: r.hasChildren, collapsed: r.collapsed, activity: a })
    }
    return out
  }

  const valueOf = new Map<string, string>()
  for (const c of state.activityCodes) if (c.code_type_id === type.id) valueOf.set(c.activity_id, c.code_value_id)
  const members = new Map<string | null, ActivityDisplayRow[]>()
  for (const r of outlineRows(state.activities, new Set())) {
    const a = byId.get(r.id)
    if (!a || isSummary(a) || (filtering && !matchesFilters(a, schedule, opts.filters))) continue
    const v = valueOf.get(a.id) ?? null
    const list = members.get(v)
    const row: ActivityDisplayRow = { kind: 'activity', id: a.id, depth: 0, wbs: r.wbs, hasChildren: false, collapsed: false, activity: a }
    if (list) list.push(row)
    else members.set(v, [row])
  }
  const values = state.codeValues
    .filter((v) => v.code_type_id === type.id)
    .sort((x, y) => x.value.localeCompare(y.value, undefined, { numeric: true }) || (x.id < y.id ? -1 : 1))
  const groups: Array<{ id: string | null; label: string }> = [
    ...values.map((v) => ({ id: v.id as string | null, label: v.value })),
    { id: null, label: `No ${type.name}` },
  ]
  const out: DisplayRow[] = []
  for (const g of groups) {
    const list = members.get(g.id)
    if (!list || list.length === 0) continue
    let start: string | null = null
    let finish: string | null = null
    for (const m of list) {
      const s = schedule.activities.get(m.id)
      if (!s) continue
      if (start === null || s.earlyStart < start) start = s.earlyStart
      if (finish === null || s.earlyFinish > finish) finish = s.earlyFinish
    }
    const id = groupRowId(g.id)
    const collapsed = opts.collapsed.has(id)
    out.push({ kind: 'group', id, label: g.label, count: list.length, start, finish, collapsed })
    if (!collapsed) out.push(...list)
  }
  return out
}

export interface ProgrammeSummaryChip { finish: string | null; critical: number; negativeFloat: number }

/** Project finish and how many activities (summaries excluded) are critical or carry negative float. */
export function summaryOf(state: ProgrammeState, schedule: ScheduleResult): ProgrammeSummaryChip {
  let critical = 0
  let negativeFloat = 0
  for (const a of state.activities) {
    if (a.is_tombstoned || isSummary(a)) continue
    const s = schedule.activities.get(a.id)
    if (!s) continue
    if (s.isCritical) critical += 1
    if (s.totalFloat < 0) negativeFloat += 1
  }
  return { finish: schedule.projectFinish, critical, negativeFloat }
}
