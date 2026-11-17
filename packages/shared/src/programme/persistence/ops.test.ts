import { describe, expect, it } from 'vitest'
import { ProgrammeOpError } from './errors'
import { applyOps, type ProgrammeOp, type ProgrammeState } from './ops'
import { activityRow, calendarRow, dependencyRow, exceptionRow, programmeRow } from './fixtures'

const state = (over: Partial<ProgrammeState> = {}): ProgrammeState => ({
  programme: programmeRow(),
  calendars: [calendarRow('SITE'), calendarRow('OFFICE')],
  exceptions: [exceptionRow('E1', 'SITE', '2026-03-05')],
  activities: [activityRow('A'), activityRow('B'), activityRow('S', { type: 'summary', original_duration: 0 }), activityRow('K', { parent_id: 'S' })],
  dependencies: [dependencyRow('L1', 'A', 'B')],
  codeTypes: [{ id: 'CT', programme_id: 'P', name: 'Phase', sort_order: null }],
  codeValues: [{ id: 'CV', code_type_id: 'CT', programme_id: 'P', value: 'Design', description: null, colour: null, organisation_tag: null, user_tag: null }],
  activityCodes: [],
  ...over,
})
const op = (o: unknown) => o as ProgrammeOp
const refuses = (s: ProgrammeState, ops: unknown[], message: string, code?: string) => {
  let err: unknown
  try { applyOps(s, ops as ProgrammeOp[]) } catch (e) { err = e }
  expect(err).toBeInstanceOf(ProgrammeOpError)
  expect((err as ProgrammeOpError).message).toBe(message)
  if (code) expect((err as ProgrammeOpError).code).toBe(code)
}

describe('applyOps: creating rows and keys', () => {
  it('upserts a new activity under key:<k>, defaults applied, and later ops use the key', () => {
    const out = applyOps(state(), [
      { op: 'upsert_activity', key: 'n1', fields: { name: 'New', original_duration: 4, parent_id: 'S' } },
      { op: 'upsert_activity', key: 'n2', fields: { name: 'Next' } },
      { op: 'upsert_dependency', pred: 'n1', succ: 'n2', type: 'SS', lag: 2 },
    ])
    const n1 = out.activities.find((a) => a.id === 'key:n1')
    expect(n1).toMatchObject({ name: 'New', original_duration: 4, parent_id: 'S', type: 'task', percent_complete: 0, percent_complete_type: 'duration', is_tombstoned: false, programme_id: 'P' })
    expect(out.activities.find((a) => a.id === 'key:n2')?.original_duration).toBe(0)
    expect(out.dependencies.at(-1)).toMatchObject({ pred_id: 'key:n1', succ_id: 'key:n2', type: 'SS', lag: 2, lag_unit: 'working_days', lag_calendar: 'pred' })
  })
  it('does not mutate its input', () => {
    const s = state()
    const copy = JSON.stringify(s)
    applyOps(s, [{ op: 'upsert_activity', id: 'A', fields: { name: 'Renamed' } }, { op: 'delete_activity', id: 'B' }])
    expect(JSON.stringify(s)).toBe(copy)
  })
  it('updates fields on an existing activity and ignores the computed cache', () => {
    const out = applyOps(state(), [op({ op: 'upsert_activity', id: 'A', fields: { name: 'Pour', early_start: '2030-01-01', is_critical: true, work_item_id: 'W', total_float: 9 } })])
    const a = out.activities.find((x) => x.id === 'A')
    expect(a).toMatchObject({ name: 'Pour', early_start: null, is_critical: false, work_item_id: null, total_float: null })
  })
  it('refuses a duplicate key', () => {
    refuses(state(), [{ op: 'upsert_activity', key: 'k', fields: { name: 'x' } }, { op: 'upsert_activity', key: 'k', fields: { name: 'y' } }],
      'Each new row in one save needs its own key.', '22023')
  })
})

describe('applyOps: field-name refusals', () => {
  it('refuses an unknown field name', () => {
    refuses(state(), [{ op: 'upsert_activity', id: 'A', fields: { nmae: 'x' } }], 'That change names a field the programme does not have: nmae.', '22023')
  })
  it('refuses is_tombstoned and ids (not writable), naming the first alphabetically', () => {
    refuses(state(), [{ op: 'upsert_activity', id: 'A', fields: { is_tombstoned: true, id: 'x' } }], 'That change names a field the programme does not have: id.', '22023')
  })
  it('knows the programme cache name project_finish and ignores it', () => {
    const out = applyOps(state(), [{ op: 'set_programme', fields: { project_finish: '2030-01-01', name: 'Renamed' } }])
    expect(out.programme).toMatchObject({ name: 'Renamed', project_finish: null })
  })
  it('refuses unknown names on calendars and set_programme; activity-only names are unknown on a calendar', () => {
    refuses(state(), [{ op: 'upsert_calendar', fields: { code: 'x' } }], 'That change names a field the programme does not have: code.', '22023')
    refuses(state(), [{ op: 'set_programme', fields: { status: 'archived' } }], 'That change names a field the programme does not have: status.', '22023')
  })
})

describe('applyOps: tombstone vs hard delete', () => {
  it('hard-deletes a bare activity and its links', () => {
    const out = applyOps(state(), [{ op: 'delete_activity', id: 'B' }])
    expect(out.activities.find((a) => a.id === 'B')).toBeUndefined()
    expect(out.dependencies).toEqual([])
  })
  const tombstones = (name: string, s: ProgrammeState) => it(`tombstones when it has ${name}: keeps the row, drops only its links`, () => {
    const out = applyOps(s, [{ op: 'delete_activity', id: 'B' }])
    expect(out.activities.find((a) => a.id === 'B')?.is_tombstoned).toBe(true)
    expect(out.dependencies).toEqual([])
  })
  tombstones('a work item', state({ activities: [activityRow('A'), activityRow('B', { work_item_id: 'W' })] }))
  tombstones('an external uid', state({ activities: [activityRow('A'), activityRow('B', { external_uid: 'U1' })] }))
  tombstones('a field update', state({ fieldUpdateActivityIds: ['B'] }))
  tombstones('a resource assignment', state({ assignmentActivityIds: ['B'] }))
  tombstones('a baseline row', state({ baselineActivityIds: ['B'] }))
  tombstones('an activity code', state({ activityCodes: [{ activity_id: 'B', code_type_id: 'CT', code_value_id: 'CV', programme_id: 'P' }] }))
  tombstones('a tombstoned child', state({ activities: [activityRow('A'), activityRow('B', { type: 'summary' }), activityRow('Z', { parent_id: 'B', is_tombstoned: true })] }))

  it('refuses while a non-tombstoned child exists', () => {
    refuses(state(), [{ op: 'delete_activity', id: 'S' }], 'Delete or move its sub-activities first.', '22023')
  })
  it('the child refusal takes precedence over history', () => {
    refuses(state({ activities: [activityRow('S', { type: 'summary', work_item_id: 'W' }), activityRow('K', { parent_id: 'S' })] }),
      [{ op: 'delete_activity', id: 'S' }], 'Delete or move its sub-activities first.')
  })
  it('refuses delete / upsert / link on a tombstoned activity', () => {
    const s = state({ activities: [activityRow('A'), activityRow('B', { is_tombstoned: true })], dependencies: [] })
    const msg = 'That activity was removed. Restore it first.'
    refuses(s, [{ op: 'delete_activity', id: 'B' }], msg, '22023')
    refuses(s, [{ op: 'upsert_activity', id: 'B', fields: { name: 'x' } }], msg, '22023')
    refuses(s, [{ op: 'upsert_dependency', pred: 'A', succ: 'B' }], msg, '22023')
    refuses(s, [{ op: 'upsert_dependency', pred: 'B', succ: 'A' }], msg, '22023')
  })
  it('refuses a delete with no id', () => {
    refuses(state(), [{ op: 'delete_activity' }], 'Say which activity to delete.', '22023')
  })
})

describe('applyOps: references', () => {
  it('refuses an unknown activity id', () => {
    refuses(state(), [{ op: 'upsert_activity', id: 'nope', fields: { name: 'x' } }], 'That activity no longer exists. Reload to see the current programme.', 'P0002')
    refuses(state(), [{ op: 'delete_activity', id: 'nope' }], 'That activity no longer exists. Reload to see the current programme.', 'P0002')
  })
  it('refuses unknown parent, calendar, link and code references', () => {
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', parent_id: 'nope' } }], 'That parent activity no longer exists. Reload to see the current programme.', 'P0002')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', calendar_id: 'nope' } }], 'That calendar no longer exists. Reload to see the current programme.', 'P0002')
    refuses(state(), [{ op: 'delete_dependency', id: 'nope' }], 'That link no longer exists. Reload to see the current programme.', 'P0002')
    refuses(state(), [{ op: 'upsert_code_value', code_type: 'nope', value: 'x' }], 'That code type no longer exists. Reload to see the current programme.', 'P0002')
    refuses(state(), [{ op: 'set_activity_code', activity: 'A', code_type: 'CT', code_value: 'nope' }], 'That code value no longer exists. Reload to see the current programme.', 'P0002')
  })
  it('a key whose row was hard-deleted earlier in the call no longer exists', () => {
    refuses(state(), [
      { op: 'upsert_activity', key: 'n', fields: { name: 'x' } },
      { op: 'delete_activity', id: 'n' },
      { op: 'upsert_activity', id: 'n', fields: { name: 'y' } },
    ], 'That activity no longer exists. Reload to see the current programme.', 'P0002')
  })
})

describe('applyOps: tree and links', () => {
  it('refuses moving an activity under its own descendant', () => {
    refuses(state(), [{ op: 'upsert_activity', id: 'S', fields: { parent_id: 'K' } }], 'An activity cannot sit under one of its own sub-activities.', '22023')
    refuses(state(), [{ op: 'upsert_activity', id: 'S', fields: { parent_id: 'S' } }], 'An activity cannot sit under one of its own sub-activities.', '22023')
  })
  it('refuses a self link, a missing end, and a duplicate link', () => {
    refuses(state(), [{ op: 'upsert_dependency', pred: 'A', succ: 'A' }], 'An activity cannot be linked to itself.', '22023')
    refuses(state(), [{ op: 'upsert_dependency', pred: 'A' }], 'A link needs a predecessor and a successor.', '22023')
    refuses(state(), [{ op: 'upsert_dependency', pred: 'A', succ: 'B' }], 'Those two activities are already linked that way.', '23505')
  })
  it('allows the same pair with another type, and edits a link by id keeping its ends', () => {
    const out = applyOps(state(), [{ op: 'upsert_dependency', pred: 'A', succ: 'B', type: 'SS' }, { op: 'upsert_dependency', id: 'L1', lag: 3, lag_unit: 'elapsed_days' }])
    expect(out.dependencies).toHaveLength(2)
    expect(out.dependencies.find((d) => d.id === 'L1')).toMatchObject({ pred_id: 'A', succ_id: 'B', lag: 3, lag_unit: 'elapsed_days', type: 'FS' })
  })
  it('refuses a delete_dependency with no id; deletes a link', () => {
    refuses(state(), [{ op: 'delete_dependency' }], 'Say which link to delete.', '22023')
    expect(applyOps(state(), [{ op: 'delete_dependency', id: 'L1' }]).dependencies).toEqual([])
  })
  it('refuses unknown ops', () => {
    refuses(state(), [{ op: 'explode' }], 'Unknown change "explode".', '22023')
    refuses(state(), [{}], 'Unknown change "(none)".', '22023')
  })
})

describe('applyOps: value checks', () => {
  const bad = 'One of the values in this change is missing or not allowed.'
  it('refuses the activity CHECK constraints', () => {
    refuses(state(), [{ op: 'upsert_activity', fields: { name: '   ' } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: {} }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'm', type: 'start_milestone', original_duration: 2 } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', constraint_type: 'snet' } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', actual_start: '2026-03-05', actual_finish: '2026-03-04' } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', fixed_start: '2026-03-05' } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', percent_complete: 101 } }], bad, '22023')
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', type: 'bogus' } }], bad, '22023')
  })
  it('refuses a malformed date with the form sentence', () => {
    refuses(state(), [{ op: 'upsert_activity', fields: { name: 'x', deadline: '05/03/2026' } }], 'One of the values in this change is not in the expected form.', '22023')
  })
  it('refuses a duplicate external uid', () => {
    refuses(state({ activities: [activityRow('A', { external_uid: 'U' })] }), [{ op: 'upsert_activity', fields: { name: 'x', external_uid: 'U' } }], 'Another activity already has that external id.', '23505')
  })
})

describe('applyOps: calendars, codes, programme', () => {
  it('creates a calendar with defaults, replaces its exceptions, refuses duplicate days', () => {
    const out = applyOps(state(), [
      { op: 'upsert_calendar', key: 'c', fields: { name: 'Night' } },
      { op: 'set_calendar_exceptions', calendar: 'c', exceptions: [{ day: '2026-04-27', kind: 'non_work', label: 'Freedom Day' }, { day: '2026-04-28', kind: 'work' }] },
      { op: 'set_calendar_exceptions', calendar: 'SITE', exceptions: [] },
      { op: 'set_programme', fields: { default_calendar_id: 'c' } },
    ])
    expect(out.calendars.find((c) => c.id === 'key:c')).toMatchObject({ name: 'Night', variant: 'custom', work_weekdays: [1, 2, 3, 4, 5], hours_per_day: 8 })
    expect(out.exceptions.filter((e) => e.calendar_id === 'key:c').map((e) => [e.day, e.kind, e.label])).toEqual([['2026-04-27', 'non_work', 'Freedom Day'], ['2026-04-28', 'work', null]])
    expect(out.exceptions.filter((e) => e.calendar_id === 'SITE')).toEqual([])
    expect(out.programme.default_calendar_id).toBe('key:c')
    refuses(state(), [{ op: 'set_calendar_exceptions', calendar: 'SITE', exceptions: [{ day: '2026-04-27' }, { day: '2026-04-27' }] }], 'The same day appears twice in the calendar exceptions.', '23505')
    refuses(state(), [{ op: 'set_calendar_exceptions', exceptions: [] }], 'Say which calendar the exceptions belong to.', '22023')
    refuses(state(), [{ op: 'set_calendar_exceptions', calendar: 'SITE', exceptions: 'x' }], 'The calendar exceptions must be sent as a list.', '22023')
  })
  it('code types, values and activity codes', () => {
    const out = applyOps(state(), [
      { op: 'upsert_code_type', key: 't', name: 'Area' },
      { op: 'upsert_code_value', key: 'v', code_type: 't', value: 'North', colour: '#aabbcc' },
      { op: 'set_activity_code', activity: 'A', code_type: 't', code_value: 'v' },
      { op: 'set_activity_code', activity: 'A', code_type: 'CT', code_value: 'CV' },
      { op: 'set_activity_code', activity: 'A', code_type: 'CT', code_value: null },
    ])
    expect(out.codeTypes.map((t) => t.name)).toEqual(['Phase', 'Area'])
    expect(out.codeValues.at(-1)).toMatchObject({ id: 'key:v', code_type_id: 'key:t', value: 'North', colour: '#aabbcc' })
    expect(out.activityCodes).toEqual([{ activity_id: 'A', code_type_id: 'key:t', code_value_id: 'key:v', programme_id: 'P' }])
    refuses(state(), [{ op: 'upsert_code_type', name: 'phase' }], 'A code type with that name already exists.', '23505')
    refuses(state(), [{ op: 'upsert_code_value', value: 'x' }], 'A code value needs a code type.', '22023')
    refuses(state({ codeTypes: [{ id: 'CT', programme_id: 'P', name: 'Phase', sort_order: null }, { id: 'CT2', programme_id: 'P', name: 'Other', sort_order: null }] }),
      [{ op: 'upsert_code_value', id: 'CV', code_type: 'CT2' }], 'A code value cannot move to another code type.', '22023')
    refuses(state(), [{ op: 'set_activity_code', activity: 'A' }], 'Say which activity and which code type.', '22023')
  })
  it('set_programme options must be an object; start is required', () => {
    refuses(state(), [{ op: 'set_programme', fields: { options: 'x' } }], 'The programme options must be an object.', '22023')
    refuses(state(), [{ op: 'set_programme', fields: { project_start: null } }], 'One of the values in this change is missing or not allowed.', '22023')
    const out = applyOps(state(), [{ op: 'set_programme', fields: { data_date: '2026-03-10', options: { floatOn: 'start' } } }])
    expect(out.programme).toMatchObject({ data_date: '2026-03-10', options: { floatOn: 'start' } })
  })
})
