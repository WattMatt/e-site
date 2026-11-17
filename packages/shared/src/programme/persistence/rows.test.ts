import { describe, expect, it } from 'vitest'
import { scheduleProgramme } from '../schedule'
import { computedFromResult, parseProgrammeOptions, rowsToProgrammeInput } from './rows'
import { activityRow, calendarRow, dependencyRow, exceptionRow, programmeRow } from './fixtures'

// Site (Mon-Fri, 5 Mar 2026 a holiday, no stored coverage) and Office (Mon-Fri, a working Saturday).
const calendars = [
  calendarRow('SITE', { variant: 'site' }),
  calendarRow('OFFICE', { variant: 'office', coverage_from: '2026-01-01', coverage_to: '2027-12-31' }),
]
const exceptions = [
  exceptionRow('E1', 'SITE', '2026-03-05'),
  exceptionRow('E2', 'OFFICE', '2026-03-07', 'work'),
]
const activities = [
  activityRow('S', { type: 'summary', original_duration: 0 }),
  activityRow('A', { parent_id: 'S', original_duration: 2 }),
  activityRow('B', { parent_id: 'S', original_duration: 3 }),
  activityRow('C', { parent_id: 'S', original_duration: 1 }),
  activityRow('M', { type: 'module_summary', original_duration: 0, fixed_start: '2026-04-01', fixed_finish: '2026-04-30' }),
  activityRow('T', { is_tombstoned: true, original_duration: 5 }),
]
const dependencies = [
  dependencyRow('L1', 'A', 'B'),
  dependencyRow('L2', 'B', 'C'),
  dependencyRow('L3', 'A', 'T'), // to a tombstoned activity: excluded
]
const base = { programme: programmeRow(), calendars, exceptions, activities, dependencies }

describe('rowsToProgrammeInput', () => {
  const input = rowsToProgrammeInput(base)

  it('drops tombstoned activities and the links that touch them', () => {
    expect(input.activities.map((a) => a.id)).toEqual(['S', 'A', 'B', 'C', 'M'])
    expect(input.dependencies.map((d) => d.id)).toEqual(['L1', 'L2'])
  })
  it('sets fixed only for a module_summary with both dates', () => {
    expect(input.activities.find((a) => a.id === 'M')?.fixed).toEqual({ start: '2026-04-01', finish: '2026-04-30' })
    expect(input.activities.find((a) => a.id === 'A')?.fixed).toBeNull()
    const half = rowsToProgrammeInput({ ...base, activities: [activityRow('M', { type: 'module_summary', original_duration: 0, fixed_start: '2026-04-01' })], dependencies: [] })
    expect(half.activities[0]?.fixed).toBeNull()
    const nonModule = rowsToProgrammeInput({ ...base, activities: [activityRow('X', { fixed_start: '2026-04-01', fixed_finish: '2026-04-02' })], dependencies: [] })
    expect(nonModule.activities[0]?.fixed).toBeNull()
  })
  it('maps constraints, parents and link fields', () => {
    const a = rowsToProgrammeInput({ ...base, activities: [activityRow('K', { constraint_type: 'snet', constraint_date: '2026-03-09', parent_id: null })], dependencies: [] })
    expect(a.activities[0]?.constraint).toEqual({ type: 'snet', date: '2026-03-09' })
    expect(input.dependencies[0]).toEqual({ id: 'L1', predId: 'A', succId: 'B', type: 'FS', lag: 0, lagUnit: 'working_days', lagCalendar: 'succ' })
  })
  it('maps calendars: exceptions split by kind, coverage from the row or project_start -1y..+5y', () => {
    const site = input.calendars.find((c) => c.id === 'SITE')
    const office = input.calendars.find((c) => c.id === 'OFFICE')
    expect(site).toMatchObject({ nonWorkDates: ['2026-03-05'], workDates: [], hoursPerDay: 8, coverage: { from: '2025-03-02', to: '2031-03-02' } })
    expect(office).toMatchObject({ nonWorkDates: [], workDates: ['2026-03-07'], coverage: { from: '2026-01-01', to: '2027-12-31' } })
    expect(input.defaultCalendarId).toBe('SITE')
    expect(input.projectStart).toBe('2026-03-02')
  })
  it('parses options with the column defaults', () => {
    expect(input.options).toEqual({ rules: 'msp', progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'smallest' })
    expect(parseProgrammeOptions({}, 'p6')).toEqual({ rules: 'p6', progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'finish' })
    expect(parseProgrammeOptions(null, 'msp').floatOn).toBe('finish')
    expect(parseProgrammeOptions({ critical: { kind: 'longest_path' }, progress: 'progress_override', floatOn: 'start' }, 'msp'))
      .toEqual({ rules: 'msp', progress: 'progress_override', critical: { kind: 'longest_path' }, floatOn: 'start' })
    expect(parseProgrammeOptions({ progress: 'nonsense', floatOn: 7, critical: { kind: 'total_float', threshold: 'x' } }, 'msp'))
      .toEqual({ rules: 'msp', progress: 'retained_logic', critical: { kind: 'total_float', threshold: 0 }, floatOn: 'finish' })
  })
  it('falls back to the first calendar when the programme has no default yet', () => {
    expect(rowsToProgrammeInput({ ...base, programme: programmeRow({ default_calendar_id: null }) }).defaultCalendarId).toBe('SITE')
  })
})

describe('scheduleProgramme over mapped rows (hand-checked)', () => {
  const result = scheduleProgramme(rowsToProgrammeInput(base))
  it('schedules A, B, C on the Site calendar skipping the 5 Mar holiday', () => {
    expect(result.ok).toBe(true)
    // A: Mon 2 + Tue 3 Mar. B: Wed 4, (Thu 5 holiday) Fri 6, Mon 9. C: Tue 10.
    const g = (id: string) => result.activities.get(id)
    expect([g('A')?.earlyStart, g('A')?.earlyFinish]).toEqual(['2026-03-02', '2026-03-03'])
    expect([g('B')?.earlyStart, g('B')?.earlyFinish]).toEqual(['2026-03-04', '2026-03-09'])
    expect([g('C')?.earlyStart, g('C')?.earlyFinish]).toEqual(['2026-03-10', '2026-03-10'])
    expect([g('S')?.earlyStart, g('S')?.earlyFinish]).toEqual(['2026-03-02', '2026-03-10'])
    expect([g('M')?.earlyStart, g('M')?.earlyFinish]).toEqual(['2026-04-01', '2026-04-30'])
    expect(g('T')).toBeUndefined()
  })
})

describe('computedFromResult', () => {
  const result = scheduleProgramme(rowsToProgrammeInput(base))
  const computed = computedFromResult(result, dependencies)
  it('maps cache columns and the project finish', () => {
    expect(computed.project_finish).toBe(result.projectFinish)
    const b = computed.activities.find((a) => a.id === 'B')
    expect(b).toMatchObject({ early_start: '2026-03-04', early_finish: '2026-03-09' })
    expect(typeof b?.total_float).toBe('number')
    expect(typeof b?.free_float).toBe('number')
  })
  it('is_driving is true for the successor of a driving link only', () => {
    const byId = Object.fromEntries(computed.activities.map((a) => [a.id, a.is_driving]))
    expect(result.drivingLinkIds.has('L1')).toBe(true)
    expect(byId.B).toBe(true)
    expect(byId.C).toBe(true)
    expect(byId.A).toBe(false)
  })
  it('returns nothing to save when the schedule failed', () => {
    const bad = scheduleProgramme(rowsToProgrammeInput({ ...base, dependencies: [dependencyRow('X', 'A', 'B'), dependencyRow('Y', 'B', 'A')] }))
    expect(bad.ok).toBe(false)
    expect(computedFromResult(bad, [])).toEqual({ project_finish: null, activities: [] })
  })
})
