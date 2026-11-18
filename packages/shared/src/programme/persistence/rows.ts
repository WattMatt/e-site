/**
 * Row shapes for the `programme` schema (migration 00261) and the mapping to
 * and from the P1 scheduling engine. snake_case mirrors the columns; dates are
 * 'YYYY-MM-DD' strings and numerics are numbers. Pure: no I/O.
 */
import type { CalendarDate } from '../../lib/dates/calendar-date'
import { ProgrammeOpError } from './errors'
import type {
  ActivityInput, ActivityType, ConstraintType, DependencyInput, EngineCalendarSpec, LagCalendar, LagUnit,
  LinkType, ProgrammeInput, ScheduleOptions, ScheduleResult,
} from '../types'

export interface ProgrammeRow {
  id: string
  project_id: string
  organisation_id: string
  kind: 'project' | 'module' | 'contractor'
  module_key: 'solar' | null
  contractor_label: string | null
  scheduling_rules: 'msp' | 'p6'
  name: string
  project_start: string
  data_date: string | null
  default_calendar_id: string | null
  /** JSONB; parsed with defaults by `parseProgrammeOptions`. */
  options: unknown
  status: 'active' | 'archived'
  project_finish: string | null
  /** The optimistic-lock version `save_changes` compares. */
  updated_at?: string
}

export interface CalendarRow {
  id: string
  programme_id: string
  name: string
  variant: 'site' | 'office' | 'custom'
  work_weekdays: number[]
  hours_per_day: number
  coverage_from: string | null
  coverage_to: string | null
}

export interface CalendarExceptionRow {
  id: string
  calendar_id: string
  day: string
  kind: 'non_work' | 'work'
  label: string | null
}

export interface ActivityRow {
  id: string
  programme_id: string
  parent_id: string | null
  wbs_code: string | null
  code: string | null
  name: string
  type: ActivityType
  original_duration: number
  remaining_duration: number | null
  calendar_id: string | null
  constraint_type: ConstraintType | null
  constraint_date: string | null
  deadline: string | null
  actual_start: string | null
  actual_finish: string | null
  percent_complete: number
  percent_complete_type: 'duration' | 'physical' | 'units'
  fixed_start: string | null
  fixed_finish: string | null
  early_start: string | null
  early_finish: string | null
  late_start: string | null
  late_finish: string | null
  total_float: number | null
  free_float: number | null
  is_critical: boolean
  is_driving: boolean
  sort_order: number | null
  external_uid: string | null
  anchor: string | null
  work_item_id: string | null
  is_tombstoned: boolean
}

export interface DependencyRow {
  id: string
  programme_id: string
  pred_id: string
  succ_id: string
  type: LinkType
  lag: number
  lag_unit: LagUnit
  lag_calendar: LagCalendar
}

export interface CodeTypeRow { id: string; programme_id: string; name: string; sort_order: number | null }
export interface CodeValueRow {
  id: string; code_type_id: string; programme_id: string; value: string; description: string | null
  colour: string | null; organisation_tag: string | null; user_tag: string | null
}
export interface ActivityCodeRow { activity_id: string; code_type_id: string; code_value_id: string; programme_id: string }

export interface ComputedRow {
  id: string
  early_start: string; early_finish: string; late_start: string; late_finish: string
  total_float: number; free_float: number
  is_critical: boolean; is_driving: boolean
}

const DEFAULT_OPTIONS = {
  progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'finish',
} as const

/** `programme.options` JSONB → engine options, with the column default for every missing or unknown part. */
export function parseProgrammeOptions(raw: unknown, rules: 'msp' | 'p6'): ScheduleOptions {
  const o = raw && typeof raw === 'object' && !Array.isArray(raw) ? (raw as Record<string, unknown>) : {}
  const progress = o.progress === 'progress_override' || o.progress === 'retained_logic' ? o.progress : DEFAULT_OPTIONS.progress
  const floatOn = o.floatOn === 'start' || o.floatOn === 'finish' || o.floatOn === 'smallest' ? o.floatOn : DEFAULT_OPTIONS.floatOn
  const c = o.critical && typeof o.critical === 'object' ? (o.critical as Record<string, unknown>) : {}
  const critical: ScheduleOptions['critical'] = c.kind === 'longest_path'
    ? { kind: 'longest_path' }
    : { kind: 'total_float', threshold: typeof c.threshold === 'number' && Number.isFinite(c.threshold) ? c.threshold : 0 }
  return { rules, progress, critical, floatOn }
}

/** Month-end-clamped year shift (Postgres `date ± interval 'n years'`). */
export function addYears(d: CalendarDate, years: number): CalendarDate {
  const y = Number(d.slice(0, 4)) + years
  const m = Number(d.slice(5, 7))
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const day = Math.min(Number(d.slice(8, 10)), last)
  return `${String(y).padStart(4, '0')}-${String(m).padStart(2, '0')}-${String(day).padStart(2, '0')}`
}

export function rowsToProgrammeInput(p: {
  programme: ProgrammeRow
  calendars: CalendarRow[]
  exceptions: CalendarExceptionRow[]
  activities: ActivityRow[]
  dependencies: DependencyRow[]
}): ProgrammeInput {
  const { programme } = p
  const defaultFrom = addYears(programme.project_start, -1)
  const defaultTo = addYears(programme.project_start, 5)

  const calendars: EngineCalendarSpec[] = p.calendars.map((c) => {
    const ex = p.exceptions.filter((e) => e.calendar_id === c.id)
    return {
      id: c.id,
      workWeekdays: [...c.work_weekdays],
      hoursPerDay: c.hours_per_day,
      nonWorkDates: ex.filter((e) => e.kind === 'non_work').map((e) => e.day).sort(),
      workDates: ex.filter((e) => e.kind === 'work').map((e) => e.day).sort(),
      coverage: { from: c.coverage_from ?? defaultFrom, to: c.coverage_to ?? defaultTo },
    }
  })

  const live = p.activities.filter((a) => !a.is_tombstoned)
  const liveIds = new Set(live.map((a) => a.id))
  const activities: ActivityInput[] = live.map((a) => ({
    id: a.id,
    parentId: a.parent_id,
    type: a.type,
    originalDuration: a.original_duration,
    remainingDuration: a.remaining_duration,
    calendarId: a.calendar_id,
    constraint: a.constraint_type ? { type: a.constraint_type, date: a.constraint_date } : null,
    deadline: a.deadline,
    actualStart: a.actual_start,
    actualFinish: a.actual_finish,
    fixed: a.type === 'module_summary' && a.fixed_start && a.fixed_finish
      ? { start: a.fixed_start, finish: a.fixed_finish } : null,
  }))
  const dependencies: DependencyInput[] = p.dependencies
    .filter((d) => liveIds.has(d.pred_id) && liveIds.has(d.succ_id))
    .map((d) => ({
      id: d.id, predId: d.pred_id, succId: d.succ_id, type: d.type, lag: d.lag, lagUnit: d.lag_unit, lagCalendar: d.lag_calendar,
    }))

  return {
    projectStart: programme.project_start,
    dataDate: programme.data_date,
    // A programme with no default calendar yet falls back to its first calendar; the engine reports unknown_calendar if there is none.
    defaultCalendarId: programme.default_calendar_id ?? calendars[0]?.id ?? '',
    calendars,
    activities,
    dependencies,
    options: parseProgrammeOptions(programme.options, programme.scheduling_rules),
  }
}

/** Engine result → the cache columns `save_changes` accepts as `p_computed`. */
export function computedFromResult(
  result: ScheduleResult,
  dependencies: DependencyRow[],
): { project_finish: string | null; activities: ComputedRow[] } {
  const driven = new Set<string>()
  for (const d of dependencies) if (result.drivingLinkIds.has(d.id)) driven.add(d.succ_id)
  const activities: ComputedRow[] = []
  for (const a of result.activities.values()) {
    activities.push({
      id: a.id,
      early_start: a.earlyStart, early_finish: a.earlyFinish, late_start: a.lateStart, late_finish: a.lateFinish,
      total_float: a.totalFloat, free_float: a.freeFloat,
      is_critical: a.isCritical, is_driving: driven.has(a.id),
    })
  }
  return { project_finish: result.projectFinish, activities }
}

/** One `p_computed.activities` entry: `id` for an existing row, `key` for a row created in the same save. */
export type ComputedSaveEntry = Omit<ComputedRow, 'id'> & ({ id: string; key?: undefined } | { key: string; id?: undefined })

/**
 * `computedFromResult` for a save that also creates rows. `save_changes`
 * resolves each entry by `coalesce(id, key)`, where a key is the one given in
 * the op list. `applyOps` names a new row `key:<k>`, so this maps it back to
 * `{ key: k }`; existing rows stay `{ id }`. A new row created WITHOUT a key
 * (`new:<n>`) cannot be addressed by the database at all, so it is refused
 * here rather than saved with a cache that can never land.
 */
export function computedForSave(
  result: ScheduleResult,
  dependencies: DependencyRow[],
): { project_finish: string | null; activities: ComputedSaveEntry[] } {
  const base = computedFromResult(result, dependencies)
  const activities = base.activities.map(({ id, ...cache }): ComputedSaveEntry => {
    if (id.startsWith('key:')) return { ...cache, key: id.slice(4) }
    if (id.startsWith('new:')) throw new ProgrammeOpError('Give each new activity a key so its schedule can be saved.', '22023')
    return { ...cache, id }
  })
  return { project_finish: base.project_finish, activities }
}
