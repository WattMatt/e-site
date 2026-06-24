import type {
  ProjectSettings,
  ProjectSettingsPatch,
  ProjectSettingsHistoryRow,
} from '../schemas/project-settings.schema'

// ─────────────────────────────────────────────────────────────────────────
// DB row shape (snake_case, as Postgres returns through the REST API).
// We use a loose `Record<string, unknown>` type because the DB types in
// `@esite/db` don't include the `projects.project_settings` table until
// `pnpm gen-types` is re-run (out of scope for PR-1b). When that happens
// we can replace with the proper generated type.
// ─────────────────────────────────────────────────────────────────────────

type ProjectSettingsRow = {
  id: string
  project_id: string
  organisation_id: string
  working_days: number[]
  holiday_calendar: string
  extra_holidays: string[]
  builders_holiday: boolean
  units: string
  date_format: string
  default_rfi_priority: string
  default_rfi_assignee_id: string | null
  default_rfi_due_days: number
  default_inspection_template_id: string | null
  contract_type: string
  contract_signed_date: string | null
  practical_completion_date: string | null
  retention_pct: string | number
  notify_rfi_email: boolean
  notify_rfi_to: string[]
  notify_inspection_email: boolean
  notify_snag_email: boolean
  notify_diary_email: boolean
  created_at: string
  updated_at: string
  updated_by: string | null
}

type ProjectSettingsHistoryRowRaw = {
  id: string
  project_id: string
  organisation_id: string
  operation: 'INSERT' | 'UPDATE' | 'DELETE'
  snapshot: ProjectSettingsRow
  diff: Record<string, [unknown, unknown]> | null
  changed_by: string | null
  changed_at: string
}

// ─────────────────────────────────────────────────────────────────────────
// rowToProjectSettings — snake_case row → camelCase ProjectSettings
// ─────────────────────────────────────────────────────────────────────────

export function rowToProjectSettings(row: ProjectSettingsRow): ProjectSettings {
  return {
    id: row.id,
    projectId: row.project_id,
    organisationId: row.organisation_id,
    workingDays: row.working_days,
    holidayCalendar: row.holiday_calendar,
    extraHolidays: row.extra_holidays,
    buildersHoliday: row.builders_holiday,
    units: row.units as ProjectSettings['units'],
    dateFormat: row.date_format,
    defaultRfiPriority: row.default_rfi_priority as ProjectSettings['defaultRfiPriority'],
    defaultRfiAssigneeId: row.default_rfi_assignee_id,
    defaultRfiDueDays: row.default_rfi_due_days,
    defaultInspectionTemplateId: row.default_inspection_template_id,
    contractType: row.contract_type as ProjectSettings['contractType'],
    contractSignedDate: row.contract_signed_date,
    practicalCompletionDate: row.practical_completion_date,
    retentionPct: typeof row.retention_pct === 'string' ? Number(row.retention_pct) : row.retention_pct,
    notifyRfiEmail: row.notify_rfi_email,
    notifyRfiTo: row.notify_rfi_to,
    notifyInspectionEmail: row.notify_inspection_email,
    notifySnagEmail: row.notify_snag_email,
    notifyDiaryEmail: row.notify_diary_email,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by,
  }
}

// ─────────────────────────────────────────────────────────────────────────
// patchToRow — camelCase patch → snake_case row patch
// Skips undefined; passes explicit nulls through unchanged.
// ─────────────────────────────────────────────────────────────────────────

export function patchToRow(patch: ProjectSettingsPatch): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  if (patch.workingDays !== undefined) out.working_days = patch.workingDays
  if (patch.holidayCalendar !== undefined) out.holiday_calendar = patch.holidayCalendar
  if (patch.extraHolidays !== undefined) out.extra_holidays = patch.extraHolidays
  if (patch.buildersHoliday !== undefined) out.builders_holiday = patch.buildersHoliday
  if (patch.units !== undefined) out.units = patch.units
  if (patch.dateFormat !== undefined) out.date_format = patch.dateFormat
  if (patch.defaultRfiPriority !== undefined) out.default_rfi_priority = patch.defaultRfiPriority
  if (patch.defaultRfiAssigneeId !== undefined) out.default_rfi_assignee_id = patch.defaultRfiAssigneeId
  if (patch.defaultRfiDueDays !== undefined) out.default_rfi_due_days = patch.defaultRfiDueDays
  if (patch.defaultInspectionTemplateId !== undefined) out.default_inspection_template_id = patch.defaultInspectionTemplateId
  if (patch.contractType !== undefined) out.contract_type = patch.contractType
  if (patch.contractSignedDate !== undefined) out.contract_signed_date = patch.contractSignedDate
  if (patch.practicalCompletionDate !== undefined) out.practical_completion_date = patch.practicalCompletionDate
  if (patch.retentionPct !== undefined) out.retention_pct = patch.retentionPct
  if (patch.notifyRfiEmail !== undefined) out.notify_rfi_email = patch.notifyRfiEmail
  if (patch.notifyRfiTo !== undefined) out.notify_rfi_to = patch.notifyRfiTo
  if (patch.notifyInspectionEmail !== undefined) out.notify_inspection_email = patch.notifyInspectionEmail
  if (patch.notifySnagEmail !== undefined) out.notify_snag_email = patch.notifySnagEmail
  if (patch.notifyDiaryEmail !== undefined) out.notify_diary_email = patch.notifyDiaryEmail
  if (patch.updatedBy !== undefined) out.updated_by = patch.updatedBy
  return out
}

// ─────────────────────────────────────────────────────────────────────────
// rowToHistoryRow — snake_case history row → typed ProjectSettingsHistoryRow
// ─────────────────────────────────────────────────────────────────────────

export function rowToHistoryRow(row: ProjectSettingsHistoryRowRaw): ProjectSettingsHistoryRow {
  return {
    id: row.id,
    projectId: row.project_id,
    organisationId: row.organisation_id,
    operation: row.operation,
    snapshot: rowToProjectSettings(row.snapshot),
    diff: row.diff,
    changedBy: row.changed_by,
    changedAt: row.changed_at,
  }
}
