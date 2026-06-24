import { z } from 'zod'

// ─────────────────────────────────────────────────────────────────────────
// Enums — mirror DB CHECK constraints from migration 00101_project_settings.sql
// ─────────────────────────────────────────────────────────────────────────

export const projectSettingsUnits = ['metric', 'imperial'] as const
export const projectSettingsRfiPriority = ['low', 'medium', 'high', 'critical'] as const
export const projectSettingsContractType = [
  'jbcc_pba', 'jbcc_mwa', 'nec3', 'nec4', 'fidic_red', 'custom', 'none',
] as const

export const projectSettingsUnitsSchema = z.enum(projectSettingsUnits)
export const projectSettingsRfiPrioritySchema = z.enum(projectSettingsRfiPriority)
export const projectSettingsContractTypeSchema = z.enum(projectSettingsContractType)

// ─────────────────────────────────────────────────────────────────────────
// Tighter-than-DB validators (M1 + M2 carry-overs from PR-1a review)
// ─────────────────────────────────────────────────────────────────────────

/** ISO weekday: 1=Mon ... 7=Sun. Array must be non-empty subset of {1..7}, no duplicates. */
export const workingDaysSchema = z
  .array(z.number().int().min(1).max(7))
  .min(1, 'working_days must contain at least one day')
  .max(7)
  .refine(
    arr => new Set(arr).size === arr.length,
    'working_days must not contain duplicates',
  )

/** notify_rfi_to: array of valid email addresses (may be empty). */
export const notifyRfiToSchema = z
  .array(z.string().email('notify_rfi_to entries must be valid email addresses'))

// ─────────────────────────────────────────────────────────────────────────
// Full ProjectSettings shape — camelCase, matches spec §6 ProjectSettings
// ─────────────────────────────────────────────────────────────────────────

export const projectSettingsSchema = z.object({
  // Identity (server-set)
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),

  // Operational defaults
  workingDays: workingDaysSchema,
  holidayCalendar: z.string().min(1).max(64),
  extraHolidays: z.array(z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'must be ISO date YYYY-MM-DD')),
  buildersHoliday: z.boolean(),
  units: projectSettingsUnitsSchema,
  dateFormat: z.string().min(1).max(32),
  defaultRfiPriority: projectSettingsRfiPrioritySchema,
  defaultRfiAssigneeId: z.string().uuid().nullable(),
  defaultRfiDueDays: z.number().int().min(1),
  defaultInspectionTemplateId: z.string().uuid().nullable(),

  // Contract
  contractType: projectSettingsContractTypeSchema,
  contractSignedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  practicalCompletionDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  retentionPct: z.number().min(0).max(100),

  // Notifications
  notifyRfiEmail: z.boolean(),
  notifyRfiTo: notifyRfiToSchema,
  notifyInspectionEmail: z.boolean(),
  notifySnagEmail: z.boolean(),
  notifyDiaryEmail: z.boolean(),

  // Audit
  createdAt: z.string(),
  updatedAt: z.string(),
  updatedBy: z.string().uuid().nullable(),
})

/** Partial patch for `update` — every column individually optional, but the same field-level validators still apply. */
export const projectSettingsPatchSchema = projectSettingsSchema
  .partial()
  .omit({ id: true, projectId: true, organisationId: true, createdAt: true, updatedAt: true })

// ─────────────────────────────────────────────────────────────────────────
// DEFAULTS — match migration 00101_project_settings.sql column defaults verbatim
// ─────────────────────────────────────────────────────────────────────────

export type ProjectSettingsDefaults = Omit<
  ProjectSettings,
  'id' | 'projectId' | 'organisationId' | 'createdAt' | 'updatedAt' | 'updatedBy'
>

export const projectSettingsDefaults: Readonly<ProjectSettingsDefaults> = Object.freeze({
  workingDays: [1, 2, 3, 4, 5],
  holidayCalendar: 'ZA',
  extraHolidays: [],
  buildersHoliday: true,
  units: 'metric',
  dateFormat: 'YYYY-MM-DD',
  defaultRfiPriority: 'medium',
  defaultRfiAssigneeId: null,
  defaultRfiDueDays: 7,
  defaultInspectionTemplateId: null,
  contractType: 'jbcc_pba',
  contractSignedDate: null,
  practicalCompletionDate: null,
  retentionPct: 5.0,
  notifyRfiEmail: true,
  notifyRfiTo: [],
  notifyInspectionEmail: false,
  notifySnagEmail: true,
  notifyDiaryEmail: true,
})

// ─────────────────────────────────────────────────────────────────────────
// History row shape — matches migration 00102_project_settings_history.sql
// ─────────────────────────────────────────────────────────────────────────

export const projectSettingsHistoryRowSchema = z.object({
  id: z.string().uuid(),
  projectId: z.string().uuid(),
  organisationId: z.string().uuid(),
  operation: z.enum(['INSERT', 'UPDATE', 'DELETE']),
  snapshot: projectSettingsSchema,
  diff: z.record(z.tuple([z.unknown(), z.unknown()])).nullable(),
  changedBy: z.string().uuid().nullable(),
  changedAt: z.string(),
})

// ─────────────────────────────────────────────────────────────────────────
// Exported types
// ─────────────────────────────────────────────────────────────────────────

export type ProjectSettings = z.infer<typeof projectSettingsSchema>
export type ProjectSettingsPatch = z.infer<typeof projectSettingsPatchSchema>
export type ProjectSettingsHistoryRow = z.infer<typeof projectSettingsHistoryRowSchema>
export type ProjectSettingsUnits = z.infer<typeof projectSettingsUnitsSchema>
export type ProjectSettingsRfiPriority = z.infer<typeof projectSettingsRfiPrioritySchema>
export type ProjectSettingsContractType = z.infer<typeof projectSettingsContractTypeSchema>
