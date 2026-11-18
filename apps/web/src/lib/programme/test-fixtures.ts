/**
 * Row fixtures for the programme web tests: what PostgREST returns for each
 * `programme.*` table (snake_case, numerics as numbers, extra columns kept).
 */
export const PRJ = '11111111-1111-4111-8111-111111111111'
export const PROG = '22222222-2222-4222-8222-222222222222'
export const VERSION = '2026-11-17T08:00:00.123456+00:00'

type Row = Record<string, unknown>

export const programmeRow = (over: Row = {}): Row => ({
  id: PROG, project_id: PRJ, organisation_id: 'ORG', kind: 'project', module_key: null, contractor_label: null,
  scheduling_rules: 'msp', name: 'Main programme', project_start: '2026-03-02', data_date: null,
  default_calendar_id: 'SITE',
  options: { progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'finish' },
  status: 'active', project_finish: null, updated_at: VERSION, ...over,
})
export const calendarRow = (id: string, over: Row = {}): Row => ({
  id, programme_id: PROG, project_id: PRJ, name: id, variant: 'site', work_weekdays: [1, 2, 3, 4, 5],
  hours_per_day: 8, coverage_from: null, coverage_to: null, ...over,
})
export const activityRow = (id: string, over: Row = {}): Row => ({
  id, programme_id: PROG, project_id: PRJ, parent_id: null, wbs_code: null, code: null, name: id, type: 'task',
  original_duration: 2, remaining_duration: null, calendar_id: null, constraint_type: null, constraint_date: null,
  deadline: null, actual_start: null, actual_finish: null, percent_complete: 0, percent_complete_type: 'duration',
  fixed_start: null, fixed_finish: null, early_start: null, early_finish: null, late_start: null, late_finish: null,
  total_float: null, free_float: null, is_critical: false, is_driving: false, sort_order: null, external_uid: null,
  anchor: null, work_item_id: null, is_tombstoned: false, ...over,
})
export const dependencyRow = (id: string, pred_id: string, succ_id: string, over: Row = {}): Row => ({
  id, programme_id: PROG, project_id: PRJ, pred_id, succ_id, type: 'FS', lag: 0, lag_unit: 'working_days',
  lag_calendar: 'pred', ...over,
})

/** A two-activity programme A → B on one Site calendar, as the tables hold it. */
export function programmeTables(over: Partial<Record<string, Row[]>> = {}): Record<string, Row[]> {
  return {
    'programme.programmes': [programmeRow()],
    'programme.calendars': [calendarRow('SITE')],
    'programme.calendar_exceptions': [],
    'programme.activities': [activityRow('A'), activityRow('B')],
    'programme.dependencies': [dependencyRow('D1', 'A', 'B')],
    'programme.code_types': [],
    'programme.code_values': [],
    'programme.activity_codes': [],
    'programme.field_updates': [],
    'programme.resource_assignments': [],
    'programme.baseline_activities': [],
    ...over,
  } as Record<string, Row[]>
}
