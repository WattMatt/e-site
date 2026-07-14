import { describe, it, expect, vi } from 'vitest'
import { projectSettingsService } from './project-settings.service'
import { projectSettingsDefaults } from '../schemas/project-settings.schema'

// Minimal mock of TypedSupabaseClient — only the methods we exercise.
// We type as `any` to bypass the strict @esite/db generated-types check,
// because the project_settings table isn't in the generated types yet.
function buildMockClient(returnPayload: { data: unknown; error: unknown }) {
  const single = vi.fn().mockResolvedValue(returnPayload)
  const maybeSingle = vi.fn().mockResolvedValue(returnPayload)
  const eq = vi.fn(() => ({ single, maybeSingle }))
  const select = vi.fn(() => ({ eq }))
  const update = vi.fn(() => ({ eq: vi.fn(() => ({ select: vi.fn(() => ({ single })) })) }))
  const insert = vi.fn(() => ({ select: vi.fn(() => ({ single })) }))
  const from = vi.fn(() => ({ select, update, insert }))
  const schema = vi.fn(() => ({ from }))
  return { schema } as any
}

describe('projectSettingsService.get', () => {
  it('returns null when no row exists (maybeSingle returns null data)', async () => {
    const client = buildMockClient({ data: null, error: null })
    const result = await projectSettingsService.get(client, '00000000-0000-0000-0000-000000000001')
    expect(result).toBeNull()
  })

  it('returns mapped ProjectSettings when row found', async () => {
    const sampleRow = {
      id: '00000000-0000-0000-0000-0000000000aa',
      project_id: '00000000-0000-0000-0000-000000000001',
      organisation_id: '00000000-0000-0000-0000-000000000099',
      working_days: [1, 2, 3, 4, 5],
      holiday_calendar: 'ZA',
      extra_holidays: [],
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
      retention_pct: '5.00',
      notify_rfi_email: true,
      notify_rfi_to: [],
      notify_inspection_email: false,
      created_at: '2026-05-26T00:00:00.000Z',
      updated_at: '2026-05-26T00:00:00.000Z',
      updated_by: null,
    }
    const client = buildMockClient({ data: sampleRow, error: null })
    const result = await projectSettingsService.get(client, '00000000-0000-0000-0000-000000000001')
    expect(result).not.toBeNull()
    expect(result!.projectId).toBe('00000000-0000-0000-0000-000000000001')
    expect(result!.workingDays).toEqual([1, 2, 3, 4, 5])
    expect(result!.retentionPct).toBe(5.0)
  })

  it('throws when supabase returns an error', async () => {
    const client = buildMockClient({ data: null, error: { message: 'boom', code: '42501' } })
    await expect(projectSettingsService.get(client, 'p1')).rejects.toThrow('boom')
  })
})

describe('projectSettingsService.DEFAULTS', () => {
  it('exposes the same defaults as the schema module', () => {
    expect(projectSettingsService.DEFAULTS).toBe(projectSettingsDefaults)
  })
  it('is frozen (immutable)', () => {
    expect(Object.isFrozen(projectSettingsService.DEFAULTS)).toBe(true)
  })
})

describe('projectSettingsService.reset', () => {
  it('builds a patch by reading DEFAULTS for the requested fields, then calls update', async () => {
    // Mock client that records what update is called with.
    let calledWith: any = null
    const stubUpdated = {
      ...{
        id: 'x', project_id: 'p', organisation_id: 'o',
        working_days: [1, 2, 3, 4, 5], holiday_calendar: 'ZA', extra_holidays: [],
        builders_holiday: true, units: 'metric', date_format: 'YYYY-MM-DD',
        default_rfi_priority: 'medium', default_rfi_assignee_id: null,
        default_rfi_due_days: 7, default_inspection_template_id: null,
        contract_type: 'jbcc_pba', contract_signed_date: null,
        practical_completion_date: null, retention_pct: '5.00',
        notify_rfi_email: true, notify_rfi_to: [], notify_inspection_email: false,
        created_at: '2026-05-26T00:00:00.000Z',
        updated_at: '2026-05-26T00:00:00.000Z', updated_by: null,
      },
    }
    const single = vi.fn().mockResolvedValue({ data: stubUpdated, error: null })
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn((patch: any) => { calledWith = patch; return { eq } })
    const from = vi.fn(() => ({ update, select: vi.fn(() => ({ eq: vi.fn(() => ({ maybeSingle: vi.fn().mockResolvedValue({ data: null, error: null }) })) })) }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    await projectSettingsService.reset(client, 'p1', ['workingDays', 'units'])

    expect(calledWith).toEqual({
      working_days: [1, 2, 3, 4, 5],
      units: 'metric',
    })
  })

  it('throws if the fields array is empty (would be a no-op)', async () => {
    const client = {} as any
    await expect(projectSettingsService.reset(client, 'p1', []))
      .rejects.toThrow(/at least one field/i)
  })
})

describe('projectSettingsService.resetAll', () => {
  it('passes a patch of all DEFAULT fields to update', async () => {
    let calledWith: any = null
    const stub = {
      id: 'x', project_id: 'p', organisation_id: 'o',
      working_days: [1, 2, 3, 4, 5], holiday_calendar: 'ZA', extra_holidays: [],
      builders_holiday: true, units: 'metric', date_format: 'YYYY-MM-DD',
      default_rfi_priority: 'medium', default_rfi_assignee_id: null,
      default_rfi_due_days: 7, default_inspection_template_id: null,
      contract_type: 'jbcc_pba', contract_signed_date: null,
      practical_completion_date: null, retention_pct: '5.00',
      notify_rfi_email: true, notify_rfi_to: [], notify_inspection_email: false,
      created_at: '2026-05-26T00:00:00.000Z',
      updated_at: '2026-05-26T00:00:00.000Z', updated_by: null,
    }
    const single = vi.fn().mockResolvedValue({ data: stub, error: null })
    const select = vi.fn(() => ({ single }))
    const eq = vi.fn(() => ({ select }))
    const update = vi.fn((patch: any) => { calledWith = patch; return { eq } })
    const from = vi.fn(() => ({ update }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    await projectSettingsService.resetAll(client, 'p1')
    expect(calledWith.working_days).toEqual([1, 2, 3, 4, 5])
    expect(calledWith.units).toBe('metric')
    expect(calledWith.retention_pct).toBe(5.0)
    expect(calledWith.notify_rfi_email).toBe(true)
    // Audit cols must NOT be in the patch (they're server-set).
    expect('created_at' in calledWith).toBe(false)
    expect('updated_at' in calledWith).toBe(false)
  })
})

describe('projectSettingsService.validatePatch', () => {
  it('returns ok=true with the parsed patch for valid input', () => {
    const result = projectSettingsService.validatePatch({
      workingDays: [1, 2, 3, 4, 5],
      units: 'metric',
    })
    expect(result.ok).toBe(true)
    if (result.ok) {
      expect(result.patch).toEqual({ workingDays: [1, 2, 3, 4, 5], units: 'metric' })
    }
  })

  it('rejects working_days outside {1..7}', () => {
    const result = projectSettingsService.validatePatch({ workingDays: [1, 2, 8] })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      // Zod's formatted error includes a fieldErrors map.
      expect(JSON.stringify(result.errors)).toMatch(/workingDays/)
    }
  })

  it('rejects empty working_days', () => {
    const result = projectSettingsService.validatePatch({ workingDays: [] })
    expect(result.ok).toBe(false)
  })

  it('rejects duplicate weekdays', () => {
    const result = projectSettingsService.validatePatch({ workingDays: [1, 1, 2] })
    expect(result.ok).toBe(false)
  })

  it('rejects invalid email in notify_rfi_to', () => {
    const result = projectSettingsService.validatePatch({
      notifyRfiTo: ['ok@example.com', 'not-an-email'],
    })
    expect(result.ok).toBe(false)
    if (!result.ok) {
      expect(JSON.stringify(result.errors)).toMatch(/notifyRfiTo/)
    }
  })

  it('rejects retention_pct > 100', () => {
    const result = projectSettingsService.validatePatch({ retentionPct: 150 })
    expect(result.ok).toBe(false)
  })

  it('rejects retention_pct < 0', () => {
    const result = projectSettingsService.validatePatch({ retentionPct: -1 })
    expect(result.ok).toBe(false)
  })

  it('rejects unknown enum values', () => {
    const result = projectSettingsService.validatePatch({ units: 'parsec' })
    expect(result.ok).toBe(false)
  })

  it('accepts empty patch (treated as no-op by `update`)', () => {
    const result = projectSettingsService.validatePatch({})
    expect(result.ok).toBe(true)
  })
})

describe('projectSettingsService.getHistory', () => {
  it('queries history table ordered newest-first with optional limit', async () => {
    const rows = [
      {
        id: 'h1', project_id: 'p1', organisation_id: 'o',
        operation: 'UPDATE' as const,
        snapshot: {
          id: 's', project_id: 'p1', organisation_id: 'o',
          working_days: [1, 2, 3, 4, 5], holiday_calendar: 'ZA', extra_holidays: [],
          builders_holiday: true, units: 'metric', date_format: 'YYYY-MM-DD',
          default_rfi_priority: 'medium', default_rfi_assignee_id: null,
          default_rfi_due_days: 7, default_inspection_template_id: null,
          contract_type: 'jbcc_pba', contract_signed_date: null,
          practical_completion_date: null, retention_pct: '7.50',
          notify_rfi_email: true, notify_rfi_to: [], notify_inspection_email: false,
          created_at: '2026-05-26T00:00:00.000Z',
          updated_at: '2026-05-26T00:01:00.000Z', updated_by: null,
        },
        diff: { retention_pct: ['5.00', '7.50'] },
        changed_by: null, changed_at: '2026-05-26T00:01:00.000Z',
      },
    ]
    const limit = vi.fn(() => ({ then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb) }))
    const order = vi.fn(() => ({ limit, then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb) }))
    const eq = vi.fn(() => ({ order }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    const result = await projectSettingsService.getHistory(client, 'p1', { limit: 5 })
    expect(result).toHaveLength(1)
    expect(result[0].operation).toBe('UPDATE')
    expect(result[0].snapshot.retentionPct).toBe(7.5)     // numeric coerced
    expect(result[0].diff).toEqual({ retention_pct: ['5.00', '7.50'] })
  })
})

describe('projectSettingsService.getAsOf', () => {
  it('returns the snapshot of the most recent history row at-or-before the given date', async () => {
    const snapshotRow = {
      id: 'h-old', project_id: 'p1', organisation_id: 'o',
      operation: 'UPDATE' as const,
      snapshot: {
        id: 's', project_id: 'p1', organisation_id: 'o',
        working_days: [1, 2, 3, 4, 5], holiday_calendar: 'ZA', extra_holidays: [],
        builders_holiday: true, units: 'metric', date_format: 'YYYY-MM-DD',
        default_rfi_priority: 'medium', default_rfi_assignee_id: null,
        default_rfi_due_days: 7, default_inspection_template_id: null,
        contract_type: 'jbcc_pba', contract_signed_date: null,
        practical_completion_date: null, retention_pct: '5.00',
        notify_rfi_email: true, notify_rfi_to: [], notify_inspection_email: false,
        created_at: '2026-05-22T00:00:00.000Z',
        updated_at: '2026-05-22T00:00:00.000Z', updated_by: null,
      },
      diff: null,
      changed_by: null, changed_at: '2026-05-22T00:00:00.000Z',
    }
    const maybeSingle = vi.fn().mockResolvedValue({ data: snapshotRow, error: null })
    const limit = vi.fn(() => ({ maybeSingle }))
    const order = vi.fn(() => ({ limit }))
    const lte = vi.fn(() => ({ order }))
    const eq = vi.fn(() => ({ lte }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    const result = await projectSettingsService.getAsOf(client, 'p1', new Date('2026-05-23T00:00:00.000Z'))
    expect(result).not.toBeNull()
    expect(result!.retentionPct).toBe(5.0)
  })

  it('returns null when no history exists before the date', async () => {
    const maybeSingle = vi.fn().mockResolvedValue({ data: null, error: null })
    const limit = vi.fn(() => ({ maybeSingle }))
    const order = vi.fn(() => ({ limit }))
    const lte = vi.fn(() => ({ order }))
    const eq = vi.fn(() => ({ lte }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    const result = await projectSettingsService.getAsOf(client, 'p1', new Date('2020-01-01T00:00:00.000Z'))
    expect(result).toBeNull()
  })
})

describe('projectSettingsService.restore', () => {
  it('reads the snapshot from the named history row and applies it as a patch', async () => {
    let updateCalledWith: any = null
    const historyRow = {
      id: 'h1', project_id: 'p1', organisation_id: 'o',
      operation: 'UPDATE' as const,
      snapshot: {
        id: 'old', project_id: 'p1', organisation_id: 'o',
        working_days: [1, 2, 3, 4, 5, 6], holiday_calendar: 'ZA', extra_holidays: ['2026-12-16'],
        builders_holiday: true, units: 'imperial', date_format: 'DD/MM/YYYY',
        default_rfi_priority: 'high', default_rfi_assignee_id: null,
        default_rfi_due_days: 14, default_inspection_template_id: null,
        contract_type: 'nec3', contract_signed_date: '2026-04-01',
        practical_completion_date: null, retention_pct: '7.50',
        notify_rfi_email: false, notify_rfi_to: ['a@b.com'],
        notify_inspection_email: true,
        created_at: '2026-05-20T00:00:00.000Z',
        updated_at: '2026-05-20T00:00:00.000Z', updated_by: null,
      },
      diff: null,
      changed_by: null, changed_at: '2026-05-20T00:00:00.000Z',
    }
    const single = vi.fn().mockResolvedValue({ data: historyRow, error: null })
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))

    const updatedRow = {
      id: 's', project_id: 'p1', organisation_id: 'o',
      working_days: [1, 2, 3, 4, 5, 6], holiday_calendar: 'ZA', extra_holidays: ['2026-12-16'],
      builders_holiday: true, units: 'imperial', date_format: 'DD/MM/YYYY',
      default_rfi_priority: 'high', default_rfi_assignee_id: null,
      default_rfi_due_days: 14, default_inspection_template_id: null,
      contract_type: 'nec3', contract_signed_date: '2026-04-01',
      practical_completion_date: null, retention_pct: '7.50',
      notify_rfi_email: false, notify_rfi_to: ['a@b.com'],
      notify_inspection_email: true,
      created_at: '2026-05-20T00:00:00.000Z',
      updated_at: '2026-05-26T00:00:00.000Z', updated_by: null,
    }
    const updSingle = vi.fn().mockResolvedValue({ data: updatedRow, error: null })
    const updSelect = vi.fn(() => ({ single: updSingle }))
    const updEq = vi.fn(() => ({ select: updSelect }))
    const update = vi.fn((patch: any) => { updateCalledWith = patch; return { eq: updEq } })

    const from = vi.fn((table: string) => {
      if (table === 'project_settings_history') return { select }
      if (table === 'project_settings') return { update }
      throw new Error(`unexpected table ${table}`)
    })
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    const result = await projectSettingsService.restore(client, 'p1', 'h1')

    expect(updateCalledWith.units).toBe('imperial')
    expect(updateCalledWith.working_days).toEqual([1, 2, 3, 4, 5, 6])
    expect(updateCalledWith.retention_pct).toBe(7.5)
    expect(result.units).toBe('imperial')
  })

  it('throws if history row not found', async () => {
    const single = vi.fn().mockResolvedValue({ data: null, error: null })
    const eq = vi.fn(() => ({ single }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any
    await expect(projectSettingsService.restore(client, 'p1', 'nonexistent'))
      .rejects.toThrow(/history row not found/i)
  })
})

describe('projectSettingsService.getFieldHistory', () => {
  it('filters by field name and returns just value/changedAt/changedBy', async () => {
    const rows = [
      {
        id: 'h1', project_id: 'p1', organisation_id: 'o',
        operation: 'UPDATE' as const,
        snapshot: {
          id: 's', project_id: 'p1', organisation_id: 'o',
          working_days: [1, 2, 3, 4, 5], holiday_calendar: 'ZA', extra_holidays: [],
          builders_holiday: true, units: 'metric', date_format: 'YYYY-MM-DD',
          default_rfi_priority: 'medium', default_rfi_assignee_id: null,
          default_rfi_due_days: 7, default_inspection_template_id: null,
          contract_type: 'jbcc_pba', contract_signed_date: null,
          practical_completion_date: null, retention_pct: '7.50',
          notify_rfi_email: true, notify_rfi_to: [], notify_inspection_email: false,
          created_at: '2026-05-26T00:00:00.000Z',
          updated_at: '2026-05-26T00:01:00.000Z', updated_by: null,
        },
        diff: { retention_pct: ['5.00', '7.50'] },
        changed_by: null, changed_at: '2026-05-26T00:01:00.000Z',
      },
    ]
    const limit = vi.fn(() => ({ then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb) }))
    const order = vi.fn(() => ({ limit, then: (cb: any) => Promise.resolve({ data: rows, error: null }).then(cb) }))
    // The filter for "field-changed" is a JSONB containment expression — we
    // can't easily mock that with the chain, so just make `contains` chainable.
    const contains = vi.fn(() => ({ order }))
    const eq = vi.fn(() => ({ contains }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    const client = { schema } as any

    const result = await projectSettingsService.getFieldHistory(client, 'p1', 'retentionPct')
    expect(result).toHaveLength(1)
    expect(result[0].value).toBe(7.5)
    expect(result[0].changedAt).toBe('2026-05-26T00:01:00.000Z')
  })
})

describe('projectSettingsService.convenience bundles', () => {
  // All five bundles read the full row via .get() then project specific
  // fields. So the mock client just needs to make .get() succeed.
  function clientForGet(row: any) {
    const maybeSingle = vi.fn().mockResolvedValue({ data: row, error: null })
    const eq = vi.fn(() => ({ maybeSingle }))
    const select = vi.fn(() => ({ eq }))
    const from = vi.fn(() => ({ select }))
    const schema = vi.fn(() => ({ from }))
    return { schema } as any
  }

  const fullRow = {
    id: 's', project_id: 'p1', organisation_id: 'o',
    working_days: [1, 2, 3, 4, 5, 6], holiday_calendar: 'ZA',
    extra_holidays: ['2026-12-16'], builders_holiday: true,
    units: 'metric', date_format: 'YYYY-MM-DD',
    default_rfi_priority: 'high', default_rfi_assignee_id: 'u1',
    default_rfi_due_days: 14,
    default_inspection_template_id: 't1',
    contract_type: 'nec3', contract_signed_date: '2026-04-01',
    practical_completion_date: '2027-04-01', retention_pct: '7.50',
    notify_rfi_email: true, notify_rfi_to: ['arno@wmeng.co.za'],
    notify_inspection_email: false,
    notify_snag_email: true, notify_diary_email: false,
    notify_qc_email: false,
    created_at: '2026-05-26T00:00:00.000Z',
    updated_at: '2026-05-26T00:00:00.000Z', updated_by: null,
  }

  it('getWorkingDayConfig returns the 4-field bundle', async () => {
    const result = await projectSettingsService.getWorkingDayConfig(clientForGet(fullRow), 'p1')
    expect(result).toEqual({
      workingDays: [1, 2, 3, 4, 5, 6],
      holidayCalendar: 'ZA',
      extraHolidays: ['2026-12-16'],
      buildersHoliday: true,
    })
  })

  it('getRfiDefaults returns priority + assigneeId + dueDays', async () => {
    const result = await projectSettingsService.getRfiDefaults(clientForGet(fullRow), 'p1')
    expect(result).toEqual({ priority: 'high', assigneeId: 'u1', dueDays: 14 })
  })

  it('getInspectionDefaults returns templateId (null-safe per M3)', async () => {
    const result = await projectSettingsService.getInspectionDefaults(clientForGet(fullRow), 'p1')
    expect(result).toEqual({ templateId: 't1' })
  })

  it('getInspectionDefaults returns null templateId when row missing', async () => {
    const result = await projectSettingsService.getInspectionDefaults(clientForGet(null), 'p1')
    expect(result).toEqual({ templateId: null })
  })

  it('getContractInfo returns 4-field contract bundle', async () => {
    const result = await projectSettingsService.getContractInfo(clientForGet(fullRow), 'p1')
    expect(result).toEqual({
      type: 'nec3',
      signedDate: '2026-04-01',
      practicalCompletionDate: '2027-04-01',
      retentionPct: 7.5,
    })
  })

  it('getNotificationConfig returns ALL six channel keys from the row', async () => {
    // Full-object toEqual: toEqual ignores undefined-valued keys, so a lost
    // mapper line (e.g. qcEmail reading a missing column → undefined) only
    // fails if EVERY key is pinned here with a concrete boolean.
    const result = await projectSettingsService.getNotificationConfig(clientForGet(fullRow), 'p1')
    expect(result).toEqual({
      rfiEmail: true,
      rfiTo: ['arno@wmeng.co.za'],
      inspectionEmail: false,
      snagEmail: true,
      diaryEmail: false,
      qcEmail: false,
    })
  })

  it('getNotificationConfig falls back to defaults when the row is missing (qcEmail: true)', async () => {
    const result = await projectSettingsService.getNotificationConfig(clientForGet(null), 'p1')
    expect(result).toEqual({
      rfiEmail: true,
      rfiTo: [],
      inspectionEmail: false,
      snagEmail: true,
      diaryEmail: true,
      qcEmail: true,
    })
  })
})

describe('projectSettingsService.subscribe', () => {
  it('subscribes to the project_settings table filtered to this projectId and invokes callback on change', () => {
    const subscribed = vi.fn()
    const channelMock = {
      on: vi.fn().mockReturnThis(),
      subscribe: vi.fn(() => subscribed()),
    }
    const client = {
      channel: vi.fn(() => channelMock),
    } as any

    const cb = vi.fn()
    const result = projectSettingsService.subscribe(client, 'p1', cb)

    expect(client.channel).toHaveBeenCalled()
    expect(channelMock.on).toHaveBeenCalledWith(
      'postgres_changes',
      expect.objectContaining({
        event: '*',
        schema: 'projects',
        table: 'project_settings',
        filter: 'project_id=eq.p1',
      }),
      expect.any(Function),
    )
    expect(channelMock.subscribe).toHaveBeenCalled()
    expect(result).toBe(channelMock)
  })
})
