import { describe, expect, it } from 'vitest'
import { buildEngineCalendar, displayFinish, displayStart, startOf, type EngineCalendar } from './calendar'
import { displayMilestone, forwardPass } from './forward'
import { normaliseProgramme } from './normalise'
import { act, dep, prog } from './test-fixtures'
import type { ProgrammeInput } from './types'

function run(input: ProgrammeInput) {
  const n = normaliseProgramme(input).value!
  const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
  const times = forwardPass(n, input, cals)
  const cal = cals.get('C')!
  const show = (id: string) => {
    const t = times.get(id)!
    return { start: displayStart(t.es), finish: displayFinish(cal, t.ef) }
  }
  return { times, show }
}

describe('forwardPass', () => {
  it('A(5) alone starts at the project start', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 })]))
    expect(show('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
  })

  it('FS 0', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B')]))
    expect(show('B')).toEqual({ start: '2026-03-09', finish: '2026-03-11' })
  })

  it('FS +2 working days', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { lag: 2 })]))
    expect(show('B')).toEqual({ start: '2026-03-11', finish: '2026-03-13' })
  })

  it('FS -2 (lead)', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { lag: -2 })]))
    expect(show('B')).toEqual({ start: '2026-03-05', finish: '2026-03-09' })
  })

  it('SS +2', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { type: 'SS', lag: 2 })]))
    expect(show('B')).toEqual({ start: '2026-03-04', finish: '2026-03-06' })
  })

  it('FF 0, B(3)', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { type: 'FF' })]))
    expect(show('B')).toEqual({ start: '2026-03-04', finish: '2026-03-06' })
  })

  it('SF 0, B(3) is held at the project start', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { type: 'SF' })]))
    expect(show('B')).toEqual({ start: '2026-03-02', finish: '2026-03-04' })
  })

  it('FS +2 elapsed days', () => {
    const { show } = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { lag: 2, lagUnit: 'elapsed_days' })]))
    expect(show('B')).toEqual({ start: '2026-03-09', finish: '2026-03-11' })
  })

  it('A(10) SS 50 %', () => {
    const { show } = run(prog([act('A', { originalDuration: 10 }), act('B', { originalDuration: 3 })], [dep('L', 'A', 'B', { type: 'SS', lag: 50, lagUnit: 'percent' })]))
    expect(show('B').start).toBe('2026-03-09')
  })

  it('finish_milestone after A(5), then FS B(3)', () => {
    const { show } = run(prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'finish_milestone', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('L1', 'A', 'M'), dep('L2', 'M', 'B')],
    ))
    expect(show('M').finish).toBe('2026-03-06')
    expect(show('B')).toEqual({ start: '2026-03-09', finish: '2026-03-11' })
  })

  it('start_milestone after A(5) FS', () => {
    const { show, times } = run(prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'start_milestone', originalDuration: 0 })],
      [dep('L1', 'A', 'M')],
    ))
    expect(show('M').start).toBe('2026-03-09')
    expect(times.get('M')!.ef).toBe(times.get('M')!.es)
  })

  it('SNET 03-11 with no preds', () => {
    const { show } = run(prog([act('B', { constraint: { type: 'snet', date: '2026-03-11' } })]))
    expect(show('B').start).toBe('2026-03-11')
  })

  it('B(3) FNET 03-20', () => {
    const { show } = run(prog([act('B', { originalDuration: 3, constraint: { type: 'fnet', date: '2026-03-20' } })]))
    expect(show('B')).toEqual({ start: '2026-03-18', finish: '2026-03-20' })
  })

  it('A(5) FS B(3), B MSO 03-04 ignores logic', () => {
    const { show } = run(prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 3, constraint: { type: 'mso', date: '2026-03-04' } })],
      [dep('L', 'A', 'B')],
    ))
    expect(show('B')).toEqual({ start: '2026-03-04', finish: '2026-03-06' })
  })

  it('projectStart on a Saturday snaps to Monday', () => {
    const { show } = run(prog([act('A', { originalDuration: 1 })], [], { projectStart: '2026-03-07' }))
    expect(show('A').start).toBe('2026-03-09')
  })

  it('module_summary uses its fixed dates, FS B(1)', () => {
    const { show } = run(prog(
      [act('S', { type: 'module_summary', originalDuration: 0, fixed: { start: '2026-03-10', finish: '2026-03-20' } }), act('B', { originalDuration: 1 })],
      [dep('L', 'S', 'B')],
    ))
    expect(show('S')).toEqual({ start: '2026-03-10', finish: '2026-03-20' })
    expect(show('B').start).toBe('2026-03-23')
  })

  it('a zero-duration task keeps ef = es', () => {
    const { times } = run(prog([act('A', { originalDuration: 5 }), act('Z', { originalDuration: 0 })], [dep('L', 'A', 'Z')]))
    expect(times.get('Z')!.ef).toBe(times.get('Z')!.es)
  })

  it('a level_of_effort never drives and gets placeholder times (ruling 1)', () => {
    const { times, show } = run(prog(
      [act('A', { originalDuration: 5 }), act('E', { type: 'level_of_effort', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('L1', 'A', 'E'), dep('L2', 'E', 'B')],
    ))
    expect(times.get('E')).toEqual({ es: times.get('A')!.es, ef: times.get('A')!.es })
    expect(show('B')).toEqual({ start: '2026-03-02', finish: '2026-03-04' })
  })
})

describe('milestone moments (ruling 3)', () => {
  const showM = (input: ProgrammeInput, id: string) => {
    const n = normaliseProgramme(input).value!
    const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
    const t = forwardPass(n, input, cals).get(id)!
    expect(t.es).toBe(t.ef)
    return displayMilestone(cals.get('C')!, t.es, t.kind!)
  }

  it('finish_milestone with no preds shows the project start', () => {
    expect(showM(prog([act('M', { type: 'finish_milestone', originalDuration: 0 })]), 'M')).toBe('2026-03-02')
  })

  it('finish_milestone with A(5) SS M shows 03-02', () => {
    expect(showM(prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'finish_milestone', originalDuration: 0 })],
      [dep('L', 'A', 'M', { type: 'SS' })],
    ), 'M')).toBe('2026-03-02')
  })

  it('finish_milestone after A(5) FS shows 03-06 and its FS successor starts 03-09', () => {
    const input = prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'finish_milestone', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('L1', 'A', 'M'), dep('L2', 'M', 'B')],
    )
    expect(showM(input, 'M')).toBe('2026-03-06')
    expect(run(input).show('B')).toEqual({ start: '2026-03-09', finish: '2026-03-11' })
  })

  it('finish_milestone with MSO 03-04 shows 03-04', () => {
    expect(showM(prog([act('M', { type: 'finish_milestone', originalDuration: 0, constraint: { type: 'mso', date: '2026-03-04' } })]), 'M')).toBe('2026-03-04')
  })

  it('start_milestone with MFO 03-04 shows 03-04', () => {
    expect(showM(prog([act('M', { type: 'start_milestone', originalDuration: 0, constraint: { type: 'mfo', date: '2026-03-04' } })]), 'M')).toBe('2026-03-04')
  })

  it('start_milestone after A(5) FS shows 03-09', () => {
    expect(showM(prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'start_milestone', originalDuration: 0 })],
      [dep('L', 'A', 'M')],
    ), 'M')).toBe('2026-03-09')
  })
})

describe('lag calendar choice', () => {
  const S6 = { id: 'S6', workWeekdays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8, nonWorkDates: [], workDates: [], coverage: { from: '2026-01-01', to: '2027-12-31' } }
  const twoCal = (lagCalendar: 'pred' | 'succ' | 'project') => {
    const base = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 1, calendarId: 'S6' })],
      [dep('L', 'A', 'B', { lag: 1, lagCalendar })],
    )
    return { ...base, calendars: [...base.calendars, S6] }
  }
  it("'pred' (C, Mon-Fri) puts B on Tue 03-10", () => {
    expect(run(twoCal('pred')).show('B').start).toBe('2026-03-10')
  })
  it("'succ' (S6, Mon-Sat) counts Sat 03-07 as the lag day, so B starts Mon 03-09", () => {
    expect(run(twoCal('succ')).show('B').start).toBe('2026-03-09')
  })
  it("'project' uses the default calendar C: Tue 03-10", () => {
    expect(run(twoCal('project')).show('B').start).toBe('2026-03-10')
  })
})

describe('forwardPass with held activities (ruling 4d)', () => {
  it('a held activity keeps its times and drives its successor', () => {
    const input = prog([act('A', { originalDuration: 1 }), act('B', { originalDuration: 2 })], [dep('L', 'A', 'B')])
    const n = normaliseProgramme(input).value!
    const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
    const heldA = { es: startOf('2026-03-04'), ef: startOf('2026-03-05') }
    const times = forwardPass(n, input, cals, new Map([['A', heldA]]))
    expect(times.get('A')).toEqual(heldA)
    expect(displayStart(times.get('B')!.es)).toBe('2026-03-05')
  })
})
