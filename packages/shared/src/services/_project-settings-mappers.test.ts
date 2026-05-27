import { describe, it, expect } from 'vitest'
import {
  rowToProjectSettings,
  patchToRow,
  rowToHistoryRow,
} from './_project-settings-mappers'
import type { ProjectSettings, ProjectSettingsPatch } from '../schemas/project-settings.schema'

// A realistic DB row shape (snake_case, as Postgres returns).
const sampleRow = {
  id: '00000000-0000-0000-0000-000000000001',
  project_id: '00000000-0000-0000-0000-000000000002',
  organisation_id: '00000000-0000-0000-0000-000000000003',
  working_days: [1, 2, 3, 4, 5],
  holiday_calendar: 'ZA',
  extra_holidays: ['2026-12-16'],
  builders_holiday: true,
  units: 'metric',
  date_format: 'YYYY-MM-DD',
  default_rfi_priority: 'medium',
  default_rfi_assignee_id: null,
  default_rfi_due_days: 7,
  default_inspection_template_id: null,
  contract_type: 'jbcc_pba',
  contract_signed_date: null,
  practical_completion_date: null,
  retention_pct: '5.00',                       // numeric → string in PG
  notify_rfi_email: true,
  notify_rfi_to: [],
  notify_inspection_email: false,
  created_at: '2026-05-26T10:00:00.000Z',
  updated_at: '2026-05-26T10:00:00.000Z',
  updated_by: null,
}

describe('rowToProjectSettings', () => {
  it('maps snake_case row to camelCase ProjectSettings', () => {
    const settings = rowToProjectSettings(sampleRow)
    expect(settings).toMatchObject({
      id: '00000000-0000-0000-0000-000000000001',
      projectId: '00000000-0000-0000-0000-000000000002',
      organisationId: '00000000-0000-0000-0000-000000000003',
      workingDays: [1, 2, 3, 4, 5],
      holidayCalendar: 'ZA',
      extraHolidays: ['2026-12-16'],
      buildersHoliday: true,
      units: 'metric',
      defaultRfiPriority: 'medium',
      defaultRfiAssigneeId: null,
      defaultRfiDueDays: 7,
      defaultInspectionTemplateId: null,
      contractType: 'jbcc_pba',
      retentionPct: 5.0,                       // string → number
      notifyRfiEmail: true,
      notifyRfiTo: [],
    })
  })

  it('coerces numeric retention_pct from string to number', () => {
    const settings = rowToProjectSettings({ ...sampleRow, retention_pct: '7.50' })
    expect(settings.retentionPct).toBe(7.5)
    expect(typeof settings.retentionPct).toBe('number')
  })

  it('preserves nulls for optional uuid fields', () => {
    const settings = rowToProjectSettings(sampleRow)
    expect(settings.defaultRfiAssigneeId).toBeNull()
    expect(settings.defaultInspectionTemplateId).toBeNull()
    expect(settings.updatedBy).toBeNull()
  })
})

describe('patchToRow', () => {
  it('maps camelCase patch to snake_case row patch', () => {
    const patch: ProjectSettingsPatch = {
      workingDays: [1, 2, 3, 4, 5, 6],
      units: 'imperial',
      defaultRfiAssigneeId: '00000000-0000-0000-0000-000000000004',
    }
    const row = patchToRow(patch)
    expect(row).toEqual({
      working_days: [1, 2, 3, 4, 5, 6],
      units: 'imperial',
      default_rfi_assignee_id: '00000000-0000-0000-0000-000000000004',
    })
  })

  it('skips undefined fields (does not emit them as nulls)', () => {
    const patch: ProjectSettingsPatch = { workingDays: [1, 2, 3] }
    const row = patchToRow(patch)
    expect(row).toEqual({ working_days: [1, 2, 3] })
    expect('units' in row).toBe(false)
    expect('default_rfi_assignee_id' in row).toBe(false)
  })

  it('passes explicit nulls through (so user can clear an optional field)', () => {
    const patch: ProjectSettingsPatch = { defaultRfiAssigneeId: null }
    const row = patchToRow(patch)
    expect(row).toEqual({ default_rfi_assignee_id: null })
  })

  it('returns an empty object for an empty patch', () => {
    expect(patchToRow({})).toEqual({})
  })
})

describe('rowToHistoryRow', () => {
  const historyRow = {
    id: '00000000-0000-0000-0000-0000000000aa',
    project_id: '00000000-0000-0000-0000-000000000002',
    organisation_id: '00000000-0000-0000-0000-000000000003',
    operation: 'UPDATE' as const,
    snapshot: sampleRow,
    diff: { retention_pct: ['5.00', '7.50'] },
    changed_by: null,
    changed_at: '2026-05-26T10:01:00.000Z',
  }

  it('deserialises snapshot JSONB into a typed ProjectSettings', () => {
    const row = rowToHistoryRow(historyRow)
    expect(row.snapshot.retentionPct).toBe(5.0)
    expect(row.snapshot.projectId).toBe('00000000-0000-0000-0000-000000000002')
  })

  it('preserves diff as-is (snake_case keys, raw tuples)', () => {
    const row = rowToHistoryRow(historyRow)
    expect(row.diff).toEqual({ retention_pct: ['5.00', '7.50'] })
  })

  it('handles INSERT row with null diff', () => {
    const row = rowToHistoryRow({ ...historyRow, operation: 'INSERT' as const, diff: null })
    expect(row.operation).toBe('INSERT')
    expect(row.diff).toBeNull()
  })
})
