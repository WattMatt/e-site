import { describe, expect, it } from 'vitest'
import { ISSUE_SEVERITY } from './types'
import type { IssueCode, ProgrammeInput } from './types'
import { validateProgramme } from './validate'

import { act, dep, prog } from './test-fixtures'
const rulesP6 = (p: ProgrammeInput): ProgrammeInput => ({ ...p, options: { ...p.options, rules: 'p6' } })

const only = (p: ProgrammeInput, code: IssueCode) => {
  const found = validateProgramme(p).filter(i => i.code === code)
  expect(found).toHaveLength(1)
  expect(found[0].severity).toBe(ISSUE_SEVERITY[code])
  return found[0]
}

describe('validateProgramme', () => {
  it('a clean programme has no issues', () => {
    expect(validateProgramme(prog([act('A'), act('B')], [dep('L', 'A', 'B')]))).toEqual([])
  })
  it('unknown pred / succ', () => {
    const i = only(prog([act('A')], [dep('L', 'A', 'Z')]), 'unknown_activity')
    expect(i.activityIds).toEqual(['Z'])
    expect(i.dependencyIds).toEqual(['L'])
    expect(only(prog([act('A')], [dep('L', 'Y', 'A')]), 'unknown_activity').activityIds).toEqual(['Y'])
  })
  it('self link', () => {
    const i = only(prog([act('A')], [dep('L', 'A', 'A')]), 'self_link')
    expect(i.activityIds).toEqual(['A'])
    expect(i.dependencyIds).toEqual(['L'])
  })
  it('duplicate link is a warning on the second occurrence', () => {
    const i = only(prog([act('A'), act('B')], [dep('L1', 'A', 'B'), dep('L2', 'A', 'B')]), 'duplicate_link')
    expect(i.severity).toBe('warning')
    expect(i.dependencyIds).toEqual(['L2'])
    expect(i.activityIds).toEqual(['A', 'B'])
  })
  it('same pair with a different type is not a duplicate', () => {
    expect(validateProgramme(prog([act('A'), act('B')], [dep('L1', 'A', 'B'), dep('L2', 'A', 'B', { type: 'SS' })]))).toEqual([])
  })
  it('missing parent', () => {
    const i = only(prog([act('A', { parentId: 'Q' })]), 'missing_parent')
    expect(i.activityIds).toEqual(['A'])
  })
  it('parent cycle is reported once', () => {
    const i = only(prog([act('A', { type: 'summary', parentId: 'B' }), act('B', { type: 'summary', parentId: 'A' }), act('C', { parentId: 'A' })]), 'parent_cycle')
    expect([...i.activityIds].sort()).toEqual(['A', 'B'])
  })
  it('unknown calendar (activity and default)', () => {
    expect(only(prog([act('A', { calendarId: 'X' })]), 'unknown_calendar').activityIds).toEqual(['A'])
    expect(only(prog([act('A')], [], { defaultCalendarId: 'NOPE' }), 'unknown_calendar').activityIds).toEqual([])
  })
  it('invalid dates', () => {
    expect(only(prog([act('A', { deadline: '2026-02-30' })]), 'invalid_date').activityIds).toEqual(['A'])
    expect(only(prog([act('A')], [], { projectStart: 'soon' }), 'invalid_date').activityIds).toEqual([])
    expect(only(prog([act('A', { constraint: { type: 'snet', date: '03/05/2026' } })]), 'invalid_date').activityIds).toEqual(['A'])
    expect(only(prog([act('A')], [], { dataDate: '2026-13-01' }), 'invalid_date').activityIds).toEqual([])
    expect(only(prog([act('A', { type: 'module_summary', fixed: { start: '2026-03-02', finish: 'x' } })]), 'invalid_date').activityIds).toEqual(['A'])
    expect(only(prog([act('A', { actualStart: 'x' })]), 'invalid_date').activityIds).toEqual(['A'])
  })
  it('milestone with a duration', () => {
    expect(only(prog([act('M', { type: 'finish_milestone', originalDuration: 2 })]), 'milestone_has_duration').activityIds).toEqual(['M'])
    expect(validateProgramme(prog([act('M', { type: 'start_milestone', originalDuration: 0 })]))).toEqual([])
  })
  it('constraint without a date (alap is fine)', () => {
    expect(only(prog([act('A', { constraint: { type: 'mso', date: null } })]), 'constraint_date_missing').activityIds).toEqual(['A'])
    expect(validateProgramme(prog([act('A', { constraint: { type: 'alap', date: null } })]))).toEqual([])
  })
  it('actual finish before start', () => {
    expect(only(prog([act('A', { actualStart: '2026-03-10', actualFinish: '2026-03-09' })]), 'actual_finish_before_start').activityIds).toEqual(['A'])
  })
  it('actual after the data date, only when there is a data date', () => {
    const a = act('A', { actualStart: '2026-03-10' })
    expect(only(prog([a], [], { dataDate: '2026-03-09' }), 'actual_after_data_date').activityIds).toEqual(['A'])
    expect(validateProgramme(prog([a], [], { dataDate: null }))).toEqual([])
    expect(only(prog([act('B', { actualStart: '2026-03-02', actualFinish: '2026-03-12' })], [], { dataDate: '2026-03-09' }), 'actual_after_data_date').activityIds).toEqual(['B'])
  })
  it('module summary without fixed dates', () => {
    expect(only(prog([act('A', { type: 'module_summary' })]), 'fixed_dates_missing').activityIds).toEqual(['A'])
  })
  it('p6 refuses links that touch a summary, msp allows them', () => {
    const p = prog([act('S', { type: 'summary' }), act('A', { parentId: 'S' }), act('X')], [dep('L', 'X', 'S')])
    expect(validateProgramme(p)).toEqual([])
    const i = only(rulesP6(p), 'summary_link_p6')
    expect(i.activityIds).toEqual(['S'])
    expect(i.dependencyIds).toEqual(['L'])
  })
  it('module_summary is a leaf, so p6 allows links to it', () => {
    const p = prog([act('M', { type: 'module_summary', fixed: { start: '2026-03-02', finish: '2026-03-06' } }), act('X')], [dep('L', 'X', 'M')])
    expect(validateProgramme(rulesP6(p))).toEqual([])
  })
})
