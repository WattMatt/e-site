export type { CalendarDate } from '../lib/dates/calendar-date'
import type { CalendarDate } from '../lib/dates/calendar-date'

export type Instant = number
export type LinkType = 'FS' | 'SS' | 'FF' | 'SF'
export type LagUnit = 'working_days' | 'elapsed_days' | 'percent'
export type LagCalendar = 'pred' | 'succ' | 'project'
export type ActivityType = 'task' | 'start_milestone' | 'finish_milestone' | 'summary' | 'level_of_effort' | 'module_summary'
export type ConstraintType = 'snet' | 'snlt' | 'fnet' | 'fnlt' | 'mso' | 'mfo' | 'alap'
export type SchedulingRules = 'msp' | 'p6'

export interface EngineCalendarSpec {
  id: string
  workWeekdays: number[]          // ISO 1=Mon … 7=Sun
  hoursPerDay: number
  nonWorkDates: CalendarDate[]    // holidays, extra holidays, shutdown days
  workDates: CalendarDate[]       // exceptional working days
  coverage: { from: CalendarDate; to: CalendarDate }  // range the exception lists are complete for
}
export interface ActivityInput {
  id: string
  parentId: string | null
  type: ActivityType
  originalDuration: number
  remainingDuration: number | null
  calendarId: string | null       // null = programme default
  constraint: { type: ConstraintType; date: CalendarDate | null } | null
  deadline: CalendarDate | null
  actualStart: CalendarDate | null
  actualFinish: CalendarDate | null
  fixed: { start: CalendarDate; finish: CalendarDate } | null   // module_summary only
}
export interface DependencyInput {
  id: string; predId: string; succId: string
  type: LinkType; lag: number; lagUnit: LagUnit; lagCalendar: LagCalendar
}
export interface ScheduleOptions {
  rules: SchedulingRules
  progress: 'retained_logic' | 'progress_override'
  critical: { kind: 'total_float'; threshold: number } | { kind: 'longest_path' }
  floatOn: 'start' | 'finish' | 'smallest'
}
export interface ProgrammeInput {
  projectStart: CalendarDate
  dataDate: CalendarDate | null
  defaultCalendarId: string
  calendars: EngineCalendarSpec[]
  activities: ActivityInput[]
  dependencies: DependencyInput[]
  options: ScheduleOptions
}
export type IssueCode =
  | 'cycle' | 'parent_cycle' | 'missing_parent' | 'unknown_activity' | 'unknown_calendar'
  | 'self_link' | 'duplicate_link' | 'invalid_date' | 'milestone_has_duration'
  | 'constraint_date_missing' | 'summary_link_p6' | 'fixed_dates_missing'
  | 'actual_finish_before_start' | 'actual_after_data_date' | 'out_of_sequence'
  | 'negative_float' | 'deadline_missed' | 'calendar_out_of_range'
export interface ScheduleIssue {
  code: IssueCode; severity: 'error' | 'warning'
  activityIds: string[]; dependencyIds: string[]; message: string
}
export interface ScheduledActivity {
  id: string
  earlyStart: CalendarDate; earlyFinish: CalendarDate
  lateStart: CalendarDate; lateFinish: CalendarDate
  totalFloat: number; freeFloat: number
  isCritical: boolean
}
export interface ScheduleResult {
  ok: boolean                      // false iff any issue has severity 'error'
  activities: Map<string, ScheduledActivity>   // empty when ok === false
  drivingLinkIds: Set<string>
  projectFinish: CalendarDate | null
  issues: ScheduleIssue[]
}

/** Errors stop scheduling; every other code is a warning. */
export const ISSUE_SEVERITY: Record<IssueCode, 'error' | 'warning'> = {
  cycle: 'error',
  parent_cycle: 'error',
  missing_parent: 'error',
  unknown_activity: 'error',
  unknown_calendar: 'error',
  self_link: 'error',
  duplicate_link: 'warning',
  invalid_date: 'error',
  milestone_has_duration: 'error',
  constraint_date_missing: 'error',
  summary_link_p6: 'error',
  fixed_dates_missing: 'error',
  actual_finish_before_start: 'error',
  actual_after_data_date: 'error',
  out_of_sequence: 'warning',
  negative_float: 'warning',
  deadline_missed: 'warning',
  calendar_out_of_range: 'warning',
}
