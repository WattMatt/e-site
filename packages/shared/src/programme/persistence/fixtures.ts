import type { ActivityRow, CalendarExceptionRow, CalendarRow, DependencyRow, ProgrammeRow } from './rows'

export const programmeRow = (over: Partial<ProgrammeRow> = {}): ProgrammeRow => ({
  id: 'P', project_id: 'PRJ', organisation_id: 'ORG', kind: 'project', module_key: null, contractor_label: null,
  scheduling_rules: 'msp', name: 'Test', project_start: '2026-03-02', data_date: null, default_calendar_id: 'SITE',
  options: { progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'smallest' },
  status: 'active', project_finish: null, updated_at: '2026-03-01T00:00:00Z', ...over,
})
export const calendarRow = (id: string, over: Partial<CalendarRow> = {}): CalendarRow => ({
  id, programme_id: 'P', name: id, variant: 'custom', work_weekdays: [1, 2, 3, 4, 5], hours_per_day: 8,
  coverage_from: null, coverage_to: null, ...over,
})
export const exceptionRow = (id: string, calendar_id: string, day: string, kind: 'non_work' | 'work' = 'non_work'): CalendarExceptionRow =>
  ({ id, calendar_id, day, kind, label: null })
export const activityRow = (id: string, over: Partial<ActivityRow> = {}): ActivityRow => ({
  id, programme_id: 'P', parent_id: null, wbs_code: null, code: null, name: id, type: 'task',
  original_duration: 1, remaining_duration: null, calendar_id: null, constraint_type: null, constraint_date: null,
  deadline: null, actual_start: null, actual_finish: null, percent_complete: 0, percent_complete_type: 'duration',
  fixed_start: null, fixed_finish: null, early_start: null, early_finish: null, late_start: null, late_finish: null,
  total_float: null, free_float: null, is_critical: false, is_driving: false, sort_order: null, external_uid: null,
  anchor: null, work_item_id: null, is_tombstoned: false, ...over,
})
export const dependencyRow = (id: string, pred_id: string, succ_id: string, over: Partial<DependencyRow> = {}): DependencyRow =>
  ({ id, programme_id: 'P', pred_id, succ_id, type: 'FS', lag: 0, lag_unit: 'working_days', lag_calendar: 'succ', ...over })
