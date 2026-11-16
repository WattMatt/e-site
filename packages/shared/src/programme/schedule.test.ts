import { describe, expect, it } from 'vitest'
import { drivingPath, scheduleProgramme } from './index'
import { act, dep, prog } from './test-fixtures'
import type { ActivityInput, DependencyInput, ProgrammeInput, ScheduleOptions } from './types'

/** The Task 5 network: A(5) FS B(4), A FS C(1), C FS D(1). */
function network(over: Record<string, Partial<ActivityInput>> = {}, links: DependencyInput[] = []): ProgrammeInput {
  return prog(
    [
      act('A', { originalDuration: 5, ...over.A }),
      act('B', { originalDuration: 4, ...over.B }),
      act('C', { originalDuration: 1, ...over.C }),
      act('D', { originalDuration: 1, ...over.D }),
    ],
    [dep('AB', 'A', 'B'), dep('AC', 'A', 'C'), dep('CD', 'C', 'D'), ...links],
  )
}

const critical = (r: ReturnType<typeof scheduleProgramme>) =>
  [...r.activities.values()].filter(a => a.isCritical).map(a => a.id).sort()

const withCritical = (p: ProgrammeInput, c: ScheduleOptions['critical']): ProgrammeInput =>
  ({ ...p, options: { ...p.options, critical: c } })

describe('scheduleProgramme', () => {
  it('schedules the Task 5 network', () => {
    const r = scheduleProgramme(network())
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.projectFinish).toBe('2026-03-12')
    expect(critical(r)).toEqual(['A', 'B'])
    expect(r.activities.get('B')).toEqual({
      id: 'B', earlyStart: '2026-03-09', earlyFinish: '2026-03-12', lateStart: '2026-03-09', lateFinish: '2026-03-12',
      totalFloat: 0, freeFloat: 0, isCritical: true,
    })
    expect(r.activities.get('C')).toMatchObject({
      earlyStart: '2026-03-09', earlyFinish: '2026-03-09', lateStart: '2026-03-11', lateFinish: '2026-03-11', totalFloat: 2, freeFloat: 0,
    })
    expect(r.activities.get('D')).toMatchObject({ totalFloat: 2, freeFloat: 2 })
    expect([...r.drivingLinkIds].sort()).toEqual(['AB', 'AC', 'CD'])
    expect(drivingPath(r, network(), 'B')).toEqual({ activityIds: ['A', 'B'], dependencyIds: ['AB'] })
    expect(drivingPath(r, network(), 'D')).toEqual({ activityIds: ['A', 'C', 'D'], dependencyIds: ['AC', 'CD'] })
    expect(drivingPath(r, network(), 'A')).toEqual({ activityIds: ['A'], dependencyIds: [] })
  })

  it('a link that leaves slack is not driving', () => {
    // E(1) FS B: E finishes 03-02, B starts 03-09 because of A, so EB does not drive.
    const p = network({}, [dep('EB', 'E', 'B')])
    p.activities.push(act('E', { originalDuration: 1 }))
    const r = scheduleProgramme(p)
    expect(r.drivingLinkIds.has('EB')).toBe(false)
    expect(r.drivingLinkIds.has('AB')).toBe(true)
    expect(drivingPath(r, p, 'B')).toEqual({ activityIds: ['A', 'B'], dependencyIds: ['AB'] })
  })

  it('total-float threshold widens the critical set', () => {
    const r = scheduleProgramme(withCritical(network(), { kind: 'total_float', threshold: 2 }))
    expect(critical(r)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('rolls a summary up from its children', () => {
    const p = prog(
      [act('S', { type: 'summary' }), act('A', { parentId: 'S', originalDuration: 5 }), act('B', { parentId: 'S', originalDuration: 3 })],
      [dep('AB', 'A', 'B')],
    )
    const r = scheduleProgramme(p)
    expect(r.ok).toBe(true)
    expect(r.activities.get('S')).toEqual({
      id: 'S', earlyStart: '2026-03-02', earlyFinish: '2026-03-11', lateStart: '2026-03-02', lateFinish: '2026-03-11',
      totalFloat: 0, freeFloat: 0, isCritical: false,
    })
    expect(r.activities.get('A')!.isCritical).toBe(true)
  })

  it('rolls nested summaries up, TF = min of the children', () => {
    const p = prog(
      [
        act('T', { type: 'summary' }),
        act('S', { type: 'summary', parentId: 'T' }),
        act('A', { parentId: 'S', originalDuration: 5 }),
        act('C', { parentId: 'T', originalDuration: 2 }),
      ],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('S')).toMatchObject({ earlyStart: '2026-03-02', earlyFinish: '2026-03-06', totalFloat: 0 })
    expect(r.activities.get('T')).toMatchObject({ earlyStart: '2026-03-02', earlyFinish: '2026-03-06', lateFinish: '2026-03-06', totalFloat: 0 })
    expect(r.activities.get('C')).toMatchObject({ totalFloat: 3 })
  })

  it('a level-of-effort spans its neighbours and is never critical', () => {
    const p = prog(
      [act('A', { originalDuration: 5 }), act('L', { type: 'level_of_effort', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('AB', 'A', 'B'), dep('AL', 'A', 'L', { type: 'SS' }), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = scheduleProgramme(p)
    expect(r.ok).toBe(true)
    expect(r.activities.get('L')).toEqual({
      id: 'L', earlyStart: '2026-03-02', earlyFinish: '2026-03-11', lateStart: '2026-03-02', lateFinish: '2026-03-11',
      totalFloat: 0, freeFloat: 0, isCritical: false,
    })
    expect(r.drivingLinkIds.has('AL')).toBe(false)
    expect(r.drivingLinkIds.has('LB')).toBe(false)
    expect(critical(r)).toEqual(['A', 'B'])
    expect(r.projectFinish).toBe('2026-03-11')
  })

  it('ruling 7(5): summary TF ignores level-of-effort descendants', () => {
    // A(5) has 2 days of float against the unrelated B(7); L (SS from A, FF to B) is an LOE child of S.
    const p = prog(
      [
        act('S', { type: 'summary' }),
        act('A', { parentId: 'S', originalDuration: 5 }),
        act('L', { parentId: 'S', type: 'level_of_effort', originalDuration: 0 }),
        act('B', { originalDuration: 7 }),
      ],
      [dep('AL', 'A', 'L', { type: 'SS' }), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('A')!.totalFloat).toBe(2)
    expect(r.activities.get('L')!.totalFloat).toBe(0)
    expect(r.activities.get('S')!.totalFloat).toBe(2)
  })

  it('ruling 7(5): a summary with only LOE descendants has TF 0 and sits at the project start', () => {
    // L follows A (FS), so its own span starts 03-09; the summary still sits at the project start.
    const p = prog(
      [act('S', { type: 'summary' }), act('L', { parentId: 'S', type: 'level_of_effort', originalDuration: 0 }), act('A', { originalDuration: 5 }), act('B', { originalDuration: 1 })],
      [dep('AL', 'A', 'L'), dep('AB', 'A', 'B'), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('L')).toMatchObject({ earlyStart: '2026-03-09' })
    expect(r.activities.get('S')).toMatchObject({ earlyStart: '2026-03-02', lateStart: '2026-03-02', totalFloat: 0 })
  })

  it('ruling 8: an LOE-only summary sits at the project start snapped to work on the default calendar', () => {
    const p = prog(
      [act('S', { type: 'summary' }), act('L', { parentId: 'S', type: 'level_of_effort', originalDuration: 0 }), act('A', { originalDuration: 5 }), act('B', { originalDuration: 1 })],
      [dep('AL', 'A', 'L'), dep('AB', 'A', 'B'), dep('LB', 'L', 'B', { type: 'FF' })],
      { projectStart: '2026-03-07' }, // a Saturday
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('S')).toMatchObject({ earlyStart: '2026-03-09', lateStart: '2026-03-09', totalFloat: 0 })
  })

  it('ruling 8: an LOE start comes from start-side predecessor demands, snapped on its calendar', () => {
    // A(5) ends Fri 03-06; FS +1 elapsed = Sunday 00:00 → L starts Mon 03-09 (not Sunday 03-08).
    const p = prog(
      [act('A', { originalDuration: 5 }), act('L', { type: 'level_of_effort', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('AL', 'A', 'L', { lag: 1, lagUnit: 'elapsed_days' }), dep('AB', 'A', 'B'), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('L')).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-11' })
  })

  it('ruling 8: an FF predecessor does not set an LOE start; with only that, the snapped project start is used', () => {
    // Before ruling 8, L showed Saturday 03-07 (A's raw finish boundary).
    const p = prog([act('A', { originalDuration: 5 }), act('L', { type: 'level_of_effort', originalDuration: 0 })], [dep('AL', 'A', 'L', { type: 'FF' })])
    const r = scheduleProgramme(p)
    expect(r.activities.get('L')).toMatchObject({ earlyStart: '2026-03-02' })
  })

  it('a finish milestone on the end-of-day boundary at the coverage edge raises no calendar_out_of_range', () => {
    // A(5) and F end at the Saturday 00:00 boundary; both show 03-06 = coverage `to`.
    const p = prog([act('A', { originalDuration: 5 }), act('F', { type: 'finish_milestone', originalDuration: 0 })], [dep('AF', 'A', 'F')])
    p.calendars = [{ ...p.calendars[0], coverage: { from: '2026-01-01', to: '2026-03-06' } }]
    const r = scheduleProgramme(p)
    expect(r.activities.get('F')).toMatchObject({ earlyFinish: '2026-03-06', lateFinish: '2026-03-06' })
    expect(r.issues.filter(i => i.code === 'calendar_out_of_range')).toEqual([])
  })

  it('longest path: only the chain that sets the finish is critical', () => {
    const p = withCritical(
      prog([act('P', { originalDuration: 5 }), act('Q', { originalDuration: 1 }), act('R', { originalDuration: 2 })], [dep('PQ', 'P', 'Q')]),
      { kind: 'longest_path' },
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('R')!.totalFloat).toBe(4)
    expect(critical(r)).toEqual(['P', 'Q'])
    expect(r.projectFinish).toBe('2026-03-09')
  })

  it('longest path ignores the float threshold: a chain with float 0 off the longest path is not critical', () => {
    // P(5)→Q(1) finishes 03-09; R(2) MFO 03-03 has TF 0 but does not reach the project finish.
    const p = withCritical(
      prog([
        act('P', { originalDuration: 5 }), act('Q', { originalDuration: 1 }),
        act('R', { originalDuration: 2, constraint: { type: 'mfo', date: '2026-03-03' } }),
      ], [dep('PQ', 'P', 'Q')]),
      { kind: 'longest_path' },
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('R')!.totalFloat).toBe(0)
    expect(critical(r)).toEqual(['P', 'Q'])
  })

  it('milestones after FS links are driven by them; a Monday-00:00 start milestone does not move the finish (ruling 7(1))', () => {
    const p = prog(
      [act('A', { originalDuration: 5 }), act('S', { type: 'start_milestone', originalDuration: 0 }), act('F', { type: 'finish_milestone', originalDuration: 0 })],
      [dep('AS', 'A', 'S'), dep('AF', 'A', 'F')],
    )
    const r = scheduleProgramme(p)
    expect(r.projectFinish).toBe('2026-03-06')
    expect(r.activities.get('F')).toMatchObject({
      earlyStart: '2026-03-06', earlyFinish: '2026-03-06', lateStart: '2026-03-06', lateFinish: '2026-03-06', totalFloat: 0, isCritical: true,
    })
    expect(r.activities.get('S')).toMatchObject({
      earlyStart: '2026-03-09', earlyFinish: '2026-03-09', lateStart: '2026-03-09', lateFinish: '2026-03-09', totalFloat: 0, isCritical: true,
    })
    expect([...r.drivingLinkIds].sort()).toEqual(['AF', 'AS'])
    expect(drivingPath(r, p, 'S')).toEqual({ activityIds: ['A', 'S'], dependencyIds: ['AS'] })
    // Longest path seeds on the project finish's working position too, so S (Monday 00:00) is on it.
    expect(critical(scheduleProgramme(withCritical(p, { kind: 'longest_path' })))).toEqual(['A', 'F', 'S'])
  })

  it('an elapsed lag landing on a weekend still drives (compared after the forward pass snaps it)', () => {
    // A(5) ends Fri 03-06; FS +1 elapsed day = Sunday → B starts Mon 03-09. FF +1 elapsed: C(2) must end by Sun → 03-05..03-06.
    const p = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 1 }), act('C', { originalDuration: 2 })],
      [dep('AB', 'A', 'B', { lag: 1, lagUnit: 'elapsed_days' }), dep('AC', 'A', 'C', { type: 'FF', lag: 1, lagUnit: 'elapsed_days' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('B')).toMatchObject({ earlyStart: '2026-03-09', earlyFinish: '2026-03-09' })
    expect(r.activities.get('C')).toMatchObject({ earlyStart: '2026-03-05', earlyFinish: '2026-03-06' })
    expect([...r.drivingLinkIds].sort()).toEqual(['AB', 'AC'])
  })

  it('an SS-lagged link into a task drives it; an FF link drives by its finish', () => {
    // A(5) SS+2 B(2): B 03-04..03-05. A FF C(2): C finishes with A, 03-05..03-06.
    const p = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 2 }), act('C', { originalDuration: 2 })],
      [dep('AB', 'A', 'B', { type: 'SS', lag: 2 }), dep('AC', 'A', 'C', { type: 'FF' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('B')).toMatchObject({ earlyStart: '2026-03-04', earlyFinish: '2026-03-05' })
    expect(r.activities.get('C')).toMatchObject({ earlyStart: '2026-03-05', earlyFinish: '2026-03-06' })
    expect([...r.drivingLinkIds].sort()).toEqual(['AB', 'AC'])
  })

  it('a completed activity is never critical', () => {
    const p = { ...network({ A: { actualStart: '2026-03-02', actualFinish: '2026-03-06' } }), dataDate: '2026-03-09' }
    const r = scheduleProgramme(p)
    expect(r.ok).toBe(true)
    expect(r.activities.get('A')!.isCritical).toBe(false)
    expect(critical(r)).toEqual(['B'])
  })

  it('percent lag from a module_summary uses its fixed span, not originalDuration', () => {
    // M fixed 03-02..03-06 = 5 working days; SS 40 % → 2 days → B starts 03-04.
    const p = prog(
      [act('M', { type: 'module_summary', originalDuration: 0, fixed: { start: '2026-03-02', finish: '2026-03-06' } }), act('B', { originalDuration: 1 })],
      [dep('MB', 'M', 'B', { type: 'SS', lag: 40, lagUnit: 'percent' })],
    )
    const r = scheduleProgramme(p)
    expect(r.activities.get('B')).toMatchObject({ earlyStart: '2026-03-04', earlyFinish: '2026-03-04' })
    expect(r.drivingLinkIds.has('MB')).toBe(true)
  })

  it('warns when the schedule runs beyond calendar coverage, still ok', () => {
    const p = network()
    p.calendars = [{ ...p.calendars[0], coverage: { from: '2026-01-01', to: '2026-03-10' } }]
    const r = scheduleProgramme(p)
    expect(r.ok).toBe(true)
    const out = r.issues.filter(i => i.code === 'calendar_out_of_range')
    expect(out).toHaveLength(1)
    expect(out[0].severity).toBe('warning')
    expect(out[0].activityIds.sort()).toEqual(['B', 'C', 'D'])
  })

  it('surfaces out_of_sequence and negative_float as warnings', () => {
    const p = {
      ...network({ C: { actualStart: '2026-03-03' }, D: { deadline: '2026-03-05' } }),
      dataDate: '2026-03-04',
    }
    const r = scheduleProgramme(p)
    expect(r.ok).toBe(true)
    const codes = r.issues.map(i => i.code)
    expect(codes).toContain('out_of_sequence')
    expect(codes).toContain('negative_float')
    expect(codes).toContain('deadline_missed')
  })

  it('a validation error gives ok:false and nothing scheduled', () => {
    const r = scheduleProgramme(prog([act('A')], [dep('X', 'A', 'nope')]))
    expect(r.ok).toBe(false)
    expect(r.activities.size).toBe(0)
    expect(r.drivingLinkIds.size).toBe(0)
    expect(r.projectFinish).toBeNull()
    expect(r.issues.some(i => i.code === 'unknown_activity' && i.severity === 'error')).toBe(true)
    expect(drivingPath(r, prog([act('A')], [dep('X', 'A', 'nope')]), 'A')).toEqual({ activityIds: [], dependencyIds: [] })
  })

  it('an actual after the data date is an error', () => {
    const r = scheduleProgramme({ ...network({ A: { actualStart: '2026-03-10' } }), dataDate: '2026-03-04' })
    expect(r.ok).toBe(false)
    expect(r.activities.size).toBe(0)
  })

  it('an empty programme has no project finish', () => {
    const r = scheduleProgramme(prog([]))
    expect(r.ok).toBe(true)
    expect(r.projectFinish).toBeNull()
    expect(r.activities.size).toBe(0)
  })

  it('rounds floats to 3 dp in the output', () => {
    // C is 1/3 day: TF is a repeating decimal internally.
    const r = scheduleProgramme(network({ C: { originalDuration: 1 / 3 } }))
    const tf = r.activities.get('C')!.totalFloat
    expect(tf).toBe(Math.round(tf * 1000) / 1000)
    expect(tf).toBeCloseTo(2.667, 3)
  })
})
