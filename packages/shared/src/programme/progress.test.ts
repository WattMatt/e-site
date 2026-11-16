import { describe, expect, it } from 'vitest'
import { applyAlap, backwardPass } from './backward'
import { buildEngineCalendar, displayFinish, displayStart, type EngineCalendar } from './calendar'
import { freeFloats, scheduleWarnings, totalFloats } from './float'
import { detectOutOfSequence, displayMilestone, forwardPass } from './forward'
import { normaliseProgramme } from './normalise'
import { act, dep, prog } from './test-fixtures'
import type { ActivityInput, DependencyInput, ProgrammeInput, ScheduleOptions } from './types'
import { validateProgramme } from './validate'

const DD = '2026-03-09' // Monday

/** Calendar C (Mon–Fri), projectStart Mon 2026-03-02, dataDate Mon 2026-03-09 unless overridden. */
function p(activities: ActivityInput[], links: DependencyInput[] = [], over: Partial<ProgrammeInput> = {},
  opts: Partial<ScheduleOptions> = {}): ProgrammeInput {
  const base = prog(activities, links, { dataDate: DD, ...over })
  return { ...base, options: { ...base.options, ...opts } }
}

function run(input: ProgrammeInput) {
  const n = normaliseProgramme(input).value!
  const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
  const early = forwardPass(n, input, cals)
  const { late, projectFinish } = backwardPass(n, input, cals, early)
  const tfs = totalFloats(n, input, cals, early, late)
  const ffs = freeFloats(n, input, cals, early, late, projectFinish)
  applyAlap(n, input, cals, early, late)
  const cal = cals.get('C')!
  const show = (t: { s: number; f: number; kind?: 'start' | 'finish' }) => (t.kind
    ? { start: displayMilestone(cal, t.s, t.kind), finish: displayMilestone(cal, t.f, t.kind) }
    : { start: displayStart(t.s), finish: displayFinish(cal, t.f) })
  const showEarly = (id: string) => { const e = early.get(id)!; return show({ s: e.es, f: e.ef, kind: e.kind }) }
  const showLate = (id: string) => { const l = late.get(id)!; return show({ s: l.ls, f: l.lf, kind: l.kind }) }
  return {
    n, early, late, showEarly, showLate,
    tf: (id: string) => tfs.get(id)!,
    ff: (id: string) => ffs.get(id)!,
    warnings: () => scheduleWarnings(n, input, cals, early, tfs),
    outOfSequence: () => detectOutOfSequence(n, input),
  }
}

describe('progress against the data date (brief, Step 1)', () => {
  it('a completed activity drives its FS successor from its actual finish', () => {
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-06' }), act('B', { originalDuration: 3 })],
      [dep('AB', 'A', 'B')],
    ))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-09', finish: '2026-03-11' })
  })

  it('an in-progress activity resumes at the data date with its remaining duration', () => {
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', remainingDuration: 3 }), act('B', { originalDuration: 3 })],
      [dep('AB', 'A', 'B')],
    ))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-11' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-12', finish: '2026-03-16' })
  })

  it('a not-started activity with no predecessors starts on the data date', () => {
    const r = run(p([act('A', { originalDuration: 5 })]))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-09', finish: '2026-03-13' })
  })

  const outOfSeq = (progress: ScheduleOptions['progress']) => p(
    [act('A', { originalDuration: 5 }), act('B', { originalDuration: 5, actualStart: '2026-03-03', remainingDuration: 2 })],
    [dep('AB', 'A', 'B')], {}, { progress },
  )

  it('out of sequence: B started before its FS predecessor A finished → warning on B', () => {
    const issues = run(outOfSeq('retained_logic')).outOfSequence()
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ code: 'out_of_sequence', severity: 'warning', activityIds: ['B'], dependencyIds: ['AB'] })
  })

  it('out of sequence, retained logic: the remaining part of B waits for A', () => {
    const r = run(outOfSeq('retained_logic'))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-09', finish: '2026-03-13' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-03', finish: '2026-03-17' })
  })

  it('out of sequence, progress override: B continues from the data date', () => {
    const r = run(outOfSeq('progress_override'))
    expect(r.showEarly('B')).toEqual({ start: '2026-03-03', finish: '2026-03-10' })
  })

  it('an actual finish after the data date is an actual_after_data_date error', () => {
    const issues = validateProgramme(p([act('A', { originalDuration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-10' })]))
    expect(issues.map(i => [i.code, i.severity])).toContainEqual(['actual_after_data_date', 'error'])
    expect(normaliseProgramme(p([act('A', { originalDuration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-10' })])).value).toBeNull()
  })
})

describe('progress: remaining duration and retained-logic demands', () => {
  it('remaining duration defaults to original minus the work done to the data date', () => {
    // Started Wed 03-04: Wed, Thu, Fri done → 2 of 5 remain from Mon 03-09.
    const r = run(p([act('A', { originalDuration: 5, actualStart: '2026-03-04' })]))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-04', finish: '2026-03-10' })
  })

  it('work done beyond the original duration leaves zero remaining, never negative', () => {
    const r = run(p([act('A', { originalDuration: 2, actualStart: '2026-03-02' }), act('B', { originalDuration: 1 })], [dep('AB', 'A', 'B')]))
    expect(r.showEarly('B')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
  })

  it('retained logic: an FF demand is applied to the remaining part', () => {
    const r = run(p(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 5, actualStart: '2026-03-03', remainingDuration: 2 })],
      [dep('AB', 'A', 'B', { type: 'FF' })],
    ))
    expect(r.showEarly('B')).toEqual({ start: '2026-03-03', finish: '2026-03-13' })
  })

  it('a not-started activity uses its remaining duration when progress is in play', () => {
    const r = run(p([act('A', { originalDuration: 5, remainingDuration: 2 })]))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-09', finish: '2026-03-10' })
  })

  it('logic and constraints are ignored for a completed activity', () => {
    const r = run(p(
      [act('P', { originalDuration: 5 }), act('A', { originalDuration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-03',
        constraint: { type: 'snet', date: '2026-03-20' } })],
      [dep('PA', 'P', 'A')],
    ))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-03' })
  })
})

describe('progress: data date null', () => {
  it('with no actual dates, progress fields are ignored (remaining duration unused, no data-date floor)', () => {
    const r = run(p([act('A', { originalDuration: 5, remainingDuration: 2 })], [], { dataDate: null }))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
  })

  it('with actual dates and no data date, the data date is the project start', () => {
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02' }), act('B', { originalDuration: 5, remainingDuration: 2 })],
      [], { dataDate: null },
    ))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-02', finish: '2026-03-03' })
  })
})

describe('progress: late dates and float (controller rulings)', () => {
  it('a completed activity has late = actual dates, TF 0 and FF 0, and is never negative float', () => {
    // B's MSO 03-04 lies before A's actual finish; without fixed actuals A's late dates would go negative.
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', actualFinish: '2026-03-06' }),
        act('B', { originalDuration: 3, constraint: { type: 'mso', date: '2026-03-04' } }),
        act('C', { originalDuration: 10 })],
      [dep('AB', 'A', 'B')],
    ))
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.tf('A')).toBe(0)
    expect(r.ff('A')).toBe(0)
    expect(r.warnings().flatMap(i => i.activityIds)).not.toContain('A')
  })

  it('an in-progress activity: ls = es, lf from logic on the remaining duration, TF is finish float', () => {
    // A ef = end 03-11; B(3) FS; C(10) runs 03-09..03-20 and sets the project finish.
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', remainingDuration: 3 }), act('B', { originalDuration: 3 }), act('C', { originalDuration: 10 })],
      [dep('AB', 'A', 'B')], {}, { floatOn: 'smallest' },
    ))
    expect(r.showEarly('C')).toEqual({ start: '2026-03-09', finish: '2026-03-20' })
    expect(r.showLate('B')).toEqual({ start: '2026-03-18', finish: '2026-03-20' })
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-17' })
    expect(r.tf('A')).toBe(4)
  })

  it('in-progress TF is finish float whatever floatOn says', () => {
    const input = (floatOn: ScheduleOptions['floatOn']) => p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', remainingDuration: 3 }), act('C', { originalDuration: 10 })],
      [], {}, { floatOn },
    )
    expect(run(input('start')).tf('A')).toBe(7)
    expect(run(input('smallest')).tf('A')).toBe(7)
    expect(run(input('finish')).tf('A')).toBe(7)
  })

  it('a started ALAP activity stays where its progress puts it', () => {
    const r = run(p(
      [act('A', { originalDuration: 5, actualStart: '2026-03-02', remainingDuration: 3, constraint: { type: 'alap', date: null } }),
        act('C', { originalDuration: 10 })],
    ))
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-11' })
  })
})

describe('progress: milestones with an actual date', () => {
  it('a start_milestone with an actual start is complete at that day, kind start', () => {
    const r = run(p([act('M', { type: 'start_milestone', originalDuration: 0, actualStart: '2026-03-04' })]))
    expect(r.early.get('M')!.kind).toBe('start')
    expect(r.showEarly('M')).toEqual({ start: '2026-03-04', finish: '2026-03-04' })
    expect(r.showLate('M')).toEqual({ start: '2026-03-04', finish: '2026-03-04' })
    expect(r.tf('M')).toBe(0)
  })

  it('a finish_milestone with an actual finish is complete at the end of that day, kind finish', () => {
    const r = run(p(
      [act('M', { type: 'finish_milestone', originalDuration: 0, actualFinish: '2026-03-04' }), act('B', { originalDuration: 1 })],
      [dep('MB', 'M', 'B')], { dataDate: '2026-03-04' },
    ))
    expect(r.early.get('M')!.kind).toBe('finish')
    expect(r.showEarly('M')).toEqual({ start: '2026-03-04', finish: '2026-03-04' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-05', finish: '2026-03-05' })
  })

  it('a finish_milestone with only an actual start is complete at the end of that day', () => {
    const r = run(p([act('M', { type: 'finish_milestone', originalDuration: 0, actualStart: '2026-03-04' })]))
    expect(r.early.get('M')).toMatchObject({ kind: 'finish' })
    expect(r.showEarly('M')).toEqual({ start: '2026-03-04', finish: '2026-03-04' })
  })

  it('a not-started milestone sits no earlier than the data date', () => {
    const r = run(p([act('M', { type: 'finish_milestone', originalDuration: 0 })]))
    expect(r.showEarly('M')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
  })
})

describe('detectOutOfSequence', () => {
  it('flags an SS predecessor that has not started; not an FF one', () => {
    const issues = run(p(
      [act('A', { originalDuration: 5 }), act('X', { originalDuration: 5 }),
        act('B', { originalDuration: 5, actualStart: '2026-03-03', remainingDuration: 2 })],
      [dep('AB', 'A', 'B', { type: 'SS' }), dep('XB', 'X', 'B', { type: 'FF' })],
    )).outOfSequence()
    expect(issues).toHaveLength(1)
    expect(issues[0]).toMatchObject({ activityIds: ['B'], dependencyIds: ['AB'] })
  })

  it('is silent when the predecessor finished (FS) or started (SS), and for not-started successors', () => {
    const issues = run(p(
      [act('A', { originalDuration: 2, actualStart: '2026-03-02', actualFinish: '2026-03-03' }),
        act('S', { originalDuration: 5, actualStart: '2026-03-02' }),
        act('B', { originalDuration: 5, actualStart: '2026-03-04' }),
        act('Q', { originalDuration: 5 }), act('R', { originalDuration: 1 })],
      [dep('AB', 'A', 'B'), dep('SB', 'S', 'B', { type: 'SS' }), dep('QR', 'Q', 'R')],
    )).outOfSequence()
    expect(issues).toEqual([])
  })
})
