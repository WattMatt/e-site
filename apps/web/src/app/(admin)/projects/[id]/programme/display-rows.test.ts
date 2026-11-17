import { describe, expect, it } from 'vitest'
import type { ProgrammeState, ScheduleResult } from '@esite/shared/programme'
import { activityRow, calendarRow, programmeRow } from '@/lib/programme/test-fixtures'
import {
  buildDisplayRows, filtersActive, NO_FILTERS, summaryOf, type DisplayRow, type Filters,
} from './display-rows'

type Row = Record<string, unknown>

function stateOf(activities: Row[], codes: { types?: Row[]; values?: Row[]; links?: Row[] } = {}): ProgrammeState {
  return {
    programme: programmeRow(), calendars: [calendarRow('SITE')], exceptions: [], activities, dependencies: [],
    codeTypes: codes.types ?? [], codeValues: codes.values ?? [], activityCodes: codes.links ?? [],
    fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
  } as unknown as ProgrammeState
}

interface S { start: string; finish: string; float?: number; critical?: boolean; lateFinish?: string }
function scheduleOf(by: Record<string, S>, projectFinish: string | null = '2026-04-30'): ScheduleResult {
  const activities = new Map(Object.entries(by).map(([id, s]) => [id, {
    id, earlyStart: s.start, earlyFinish: s.finish, lateStart: s.start, lateFinish: s.lateFinish ?? s.finish,
    totalFloat: s.float ?? 0, freeFloat: 0, isCritical: s.critical === true,
  }]))
  return { ok: true, activities, drivingLinkIds: new Set(), projectFinish, issues: [] }
}

const f = (over: Partial<Filters>): Filters => ({ ...NO_FILTERS, ...over })
const ids = (rows: DisplayRow[]) => rows.map((r) => r.id)
const none = new Set<string>()

// A (summary) → B, C ; D (summary) → E ; F alone
const tree = () => [
  activityRow('A', { type: 'summary', sort_order: 1, name: 'Site works' }),
  activityRow('B', { parent_id: 'A', sort_order: 1, name: 'Excavate' }),
  activityRow('C', { parent_id: 'A', sort_order: 2, name: 'Backfill', code: 'BF-1' }),
  activityRow('D', { type: 'summary', sort_order: 2, name: 'Structure' }),
  activityRow('E', { parent_id: 'D', sort_order: 1, name: 'Handover', type: 'finish_milestone', original_duration: 0 }),
  activityRow('F', { sort_order: 3, name: 'Snag list' }),
]
const sched = () => scheduleOf({
  A: { start: '2026-03-02', finish: '2026-03-10' }, B: { start: '2026-03-02', finish: '2026-03-04', critical: true },
  C: { start: '2026-03-05', finish: '2026-03-10', float: -2 }, D: { start: '2026-03-11', finish: '2026-03-11' },
  E: { start: '2026-03-11', finish: '2026-03-11' }, F: { start: '2026-03-12', finish: '2026-03-13', float: 5 },
})

describe('buildDisplayRows: WBS', () => {
  it('without filters it is the outline', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: NO_FILTERS, groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
    expect(rows[1]).toMatchObject({ kind: 'activity', depth: 1, wbs: '1.1' })
  })

  it('a collapsed parent hides its children', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: new Set(['A']), filters: NO_FILTERS, groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'D', 'E', 'F'])
  })

  it('a text match keeps its ancestors so the hierarchy reads, and drops the rest', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: f({ search: 'backfill' }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'C'])
  })

  it('the text matches the code as well as the name, ignoring case', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: f({ search: 'bf-1' }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'C'])
  })

  it('a filtered view ignores collapse, so a match is never hidden', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: new Set(['A']), filters: f({ search: 'excavate' }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'B'])
  })

  it('critical only keeps critical rows and their ancestors', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: f({ criticalOnly: true }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'B'])
  })

  it('late or negative float keeps negative-float rows and rows that finish after their deadline', () => {
    const acts = tree().map((a) => (a.id === 'F' ? { ...a, deadline: '2026-03-12' } : a))
    const rows = buildDisplayRows(stateOf(acts), sched(), { collapsed: none, filters: f({ lateOrNegative: true }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['A', 'C', 'F'])
  })

  it('milestones only keeps milestones under their ancestors', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: f({ milestonesOnly: true }), groupBy: 'wbs' })
    expect(ids(rows)).toEqual(['D', 'E'])
  })

  it('filters combine (all must hold)', () => {
    const rows = buildDisplayRows(stateOf(tree()), sched(), { collapsed: none, filters: f({ criticalOnly: true, search: 'backfill' }), groupBy: 'wbs' })
    expect(rows).toEqual([])
  })

  it('filtersActive is false for the empty filters and for blank text', () => {
    expect(filtersActive(NO_FILTERS)).toBe(false)
    expect(filtersActive(f({ search: '   ' }))).toBe(false)
    expect(filtersActive(f({ milestonesOnly: true }))).toBe(true)
  })
})

describe('buildDisplayRows: group by code', () => {
  const codes = {
    types: [{ id: 'T1', name: 'Trade', programme_id: 'P', sort_order: 1 }],
    values: [
      { id: 'V-ELEC', code_type_id: 'T1', value: 'Electrical', description: null },
      { id: 'V-CIV', code_type_id: 'T1', value: 'Civil', description: null },
    ],
    links: [
      { activity_id: 'B', code_type_id: 'T1', code_value_id: 'V-CIV' },
      { activity_id: 'C', code_type_id: 'T1', code_value_id: 'V-CIV' },
      { activity_id: 'E', code_type_id: 'T1', code_value_id: 'V-ELEC' },
    ],
  }
  const grouped = (extra: Partial<{ collapsed: Set<string>; filters: Filters }> = {}) =>
    buildDisplayRows(stateOf(tree(), codes), sched(), { collapsed: extra.collapsed ?? none, filters: extra.filters ?? NO_FILTERS, groupBy: 'T1' })

  it('a header per code value (sorted), then its activities flat; summaries are not listed; no-value last', () => {
    const rows = grouped()
    expect(ids(rows)).toEqual(['group:V-CIV', 'B', 'C', 'group:V-ELEC', 'E', 'group:none', 'F'])
    expect(rows[1]).toMatchObject({ kind: 'activity', depth: 0, hasChildren: false })
  })

  it('a header carries the value, the count, the earliest start and the latest finish', () => {
    const [civil, , , elec, , none_] = grouped()
    expect(civil).toMatchObject({ kind: 'group', label: 'Civil', count: 2, start: '2026-03-02', finish: '2026-03-10' })
    expect(elec).toMatchObject({ kind: 'group', label: 'Electrical', count: 1, start: '2026-03-11', finish: '2026-03-11' })
    expect(none_).toMatchObject({ kind: 'group', label: 'No Trade', count: 1 })
  })

  it('a collapsed group hides its activities but keeps its header', () => {
    expect(ids(grouped({ collapsed: new Set(['group:V-CIV']) }))).toEqual(['group:V-CIV', 'group:V-ELEC', 'E', 'group:none', 'F'])
    expect(grouped({ collapsed: new Set(['group:V-CIV']) })[0]).toMatchObject({ collapsed: true })
  })

  it('filters apply inside groups and empty groups disappear', () => {
    expect(ids(grouped({ filters: f({ criticalOnly: true }) }))).toEqual(['group:V-CIV', 'B'])
  })

  it('an unknown code type falls back to the WBS outline', () => {
    const rows = buildDisplayRows(stateOf(tree(), codes), sched(), { collapsed: none, filters: NO_FILTERS, groupBy: 'gone' })
    expect(ids(rows)).toEqual(['A', 'B', 'C', 'D', 'E', 'F'])
  })
})

describe('summaryOf', () => {
  it('counts critical and negative-float activities (summaries not counted) and gives the project finish', () => {
    expect(summaryOf(stateOf(tree()), sched())).toEqual({ finish: '2026-04-30', critical: 1, negativeFloat: 1 })
  })
})
