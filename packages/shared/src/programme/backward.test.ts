import { describe, expect, it } from 'vitest'
import { applyAlap, backwardPass } from './backward'
import { buildEngineCalendar, displayFinish, displayStart, startOf, type EngineCalendar } from './calendar'
import { freeFloats, scheduleWarnings, totalFloat, totalFloats } from './float'
import { displayMilestone, forwardPass } from './forward'
import { normaliseProgramme } from './normalise'
import { act, dep, prog } from './test-fixtures'
import type { ActivityInput, DependencyInput, ProgrammeInput, ScheduleOptions } from './types'

function run(input: ProgrammeInput, opts: { alap?: boolean } = {}) {
  const n = normaliseProgramme(input).value!
  const cals = new Map<string, EngineCalendar>(input.calendars.map(c => [c.id, buildEngineCalendar(c)]))
  const early = forwardPass(n, input, cals)
  const { late, projectFinish } = backwardPass(n, input, cals, early)
  // The call order Task 7 follows: floats from the pre-ALAP early dates, then ALAP, then warnings.
  const pre = new Map(early)
  const tfs = totalFloats(n, input, cals, early, late)
  const ffs = freeFloats(n, input, cals, early, late, projectFinish)
  if (opts.alap) applyAlap(n, input, cals, early, late)
  const cal = cals.get('C')!
  const showLate = (id: string) => {
    const l = late.get(id)!
    if (l.kind) return { start: displayMilestone(cal, l.ls, l.kind), finish: displayMilestone(cal, l.lf, l.kind) }
    return { start: displayStart(l.ls), finish: displayFinish(cal, l.lf) }
  }
  const showEarly = (id: string) => {
    const e = early.get(id)!
    if (e.kind) return { start: displayMilestone(cal, e.es, e.kind), finish: displayMilestone(cal, e.ef, e.kind) }
    return { start: displayStart(e.es), finish: displayFinish(cal, e.ef) }
  }
  const tf = (id: string, on: ScheduleOptions['floatOn'] = 'smallest') => totalFloat(cal, pre.get(id)!, late.get(id)!, on)
  const ff = (id: string) => ffs.get(id)!
  const warnings = () => scheduleWarnings(n, input, cals, early, tfs)
  return { n, cals, input, early, late, projectFinish, showLate, showEarly, tf, ff, warnings }
}

/** A(5) FS B(4), A FS C(1), C FS D(1). */
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

describe('backwardPass', () => {
  it('early dates of the network are as given', () => {
    const r = run(network())
    expect(r.showEarly('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-09', finish: '2026-03-12' })
    expect(r.showEarly('C')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
    expect(r.showEarly('D')).toEqual({ start: '2026-03-10', finish: '2026-03-10' })
    expect(r.projectFinish).toBe(startOf('2026-03-12') + 1)
  })

  it('late dates', () => {
    const r = run(network())
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.showLate('B')).toEqual({ start: '2026-03-09', finish: '2026-03-12' })
    expect(r.showLate('C')).toEqual({ start: '2026-03-11', finish: '2026-03-11' })
    expect(r.showLate('D')).toEqual({ start: '2026-03-12', finish: '2026-03-12' })
  })

  it('total float A 0, B 0, C 2, D 2; free float C 0, D 2, A 0', () => {
    const r = run(network())
    expect([r.tf('A'), r.tf('B'), r.tf('C'), r.tf('D')]).toEqual([0, 0, 2, 2])
    expect([r.ff('C'), r.ff('D'), r.ff('A')]).toEqual([0, 2, 0])
  })

  it("floatOn 'finish' equals 'start' on this network", () => {
    const r = run(network())
    expect(r.tf('C', 'start')).toBe(2)
    expect(r.tf('C', 'finish')).toBe(2)
  })

  it('D FNLT 03-10: D TF 0 and C TF 0', () => {
    const r = run(network({ D: { constraint: { type: 'fnlt', date: '2026-03-10' } } }))
    expect(r.tf('D')).toBe(0)
    expect(r.tf('C')).toBe(0)
    expect(r.warnings()).toEqual([])
  })

  it('D FNLT 03-09: D TF -1 and a negative_float warning naming D', () => {
    const r = run(network({ D: { constraint: { type: 'fnlt', date: '2026-03-09' } } }))
    expect(r.tf('D')).toBe(-1)
    const neg = r.warnings().filter(i => i.code === 'negative_float')
    expect(neg).toHaveLength(1)
    expect(neg[0].severity).toBe('warning')
    expect(neg[0].activityIds).toContain('D')
  })

  it('B deadline 03-11: B TF -1 and deadline_missed', () => {
    const r = run(network({ B: { deadline: '2026-03-11' } }))
    expect(r.tf('B')).toBe(-1)
    const missed = r.warnings().filter(i => i.code === 'deadline_missed')
    expect(missed).toHaveLength(1)
    expect(missed[0].severity).toBe('warning')
    expect(missed[0].activityIds).toEqual(['B'])
  })

  it('a met deadline gives no deadline_missed', () => {
    const r = run(network({ B: { deadline: '2026-03-12' } }))
    expect(r.tf('B')).toBe(0)
    expect(r.warnings()).toEqual([])
  })

  it('C ALAP displays 03-11..03-11 with free float 0', () => {
    const r = run(network({ C: { constraint: { type: 'alap', date: null } } }), { alap: true })
    expect(r.showEarly('C')).toEqual({ start: '2026-03-11', finish: '2026-03-11' })
    expect(r.ff('C')).toBe(0)
  })

  it('an SS successor limits the late start; the late finish is that + duration', () => {
    const r = run(prog([act('A', { originalDuration: 3 }), act('B', { originalDuration: 5 })], [dep('L', 'A', 'B', { type: 'SS' })]))
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-04' })
    expect(r.tf('A')).toBe(0)
    expect(r.ff('A')).toBe(0)
  })

  it('an MSO activity with room before the project finish is still fixed both ways (TF 0, not 2)', () => {
    const r = run(network({ D: { constraint: { type: 'mso', date: '2026-03-10' } } }))
    expect(r.showLate('D')).toEqual({ start: '2026-03-10', finish: '2026-03-10' })
    expect(r.tf('D')).toBe(0)
    expect(r.tf('C')).toBe(0)
  })

  it('A(5) FS B(3), B MSO 03-04: B fixed both ways (TF 0), A late start 02-25, A TF -3, warning, no throw', () => {
    const input = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 3, constraint: { type: 'mso', date: '2026-03-04' } })],
      [dep('L', 'A', 'B')],
    )
    const r = run(input)
    expect(r.tf('B')).toBe(0)
    expect(r.showLate('B')).toEqual(r.showEarly('B'))
    expect(r.showLate('A')).toEqual({ start: '2026-02-25', finish: '2026-03-03' })
    expect(r.tf('A')).toBe(-3)
    const neg = r.warnings().filter(i => i.code === 'negative_float')
    expect(neg).toHaveLength(1)
    expect(neg[0].activityIds).toContain('A')
    expect(neg[0].activityIds).not.toContain('B')
  })
})

describe('late moments of milestones', () => {
  // A(5) and B(7) run in parallel; project finish is the end of 03-10.
  const base = (m: ActivityInput) =>
    prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 7 }), m], [dep('AM', 'A', 'M')])

  it("finish_milestone after A FS: late moment from project finish, kind 'finish', shows 03-10, TF 2", () => {
    const r = run(base(act('M', { type: 'finish_milestone', originalDuration: 0 })))
    expect(r.late.get('M')!.kind).toBe('finish')
    expect(r.showLate('M')).toEqual({ start: '2026-03-10', finish: '2026-03-10' })
    expect(r.tf('M')).toBe(2)
  })

  it("finish_milestone with SNLT 03-09: late moment from the date, kind 'start', shows 03-09, TF 0", () => {
    const r = run(base(act('M', { type: 'finish_milestone', originalDuration: 0, constraint: { type: 'snlt', date: '2026-03-09' } })))
    expect(r.late.get('M')!.kind).toBe('start')
    expect(r.showLate('M')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
    expect(r.tf('M')).toBe(0)
  })

  it("start_milestone after A FS: late moment snapped to a working start, kind 'start', shows 03-11, TF 2", () => {
    const r = run(base(act('M', { type: 'start_milestone', originalDuration: 0 })))
    const l = r.late.get('M')!
    expect(l.kind).toBe('start')
    expect(l.ls).toBe(l.lf)
    expect(l.ls).toBe(startOf('2026-03-11'))
    expect(r.showLate('M')).toEqual({ start: '2026-03-11', finish: '2026-03-11' })
    expect(r.tf('M')).toBe(2)
  })

  it('start_milestone whose late moment is a Friday-end boundary snaps to Monday 03-09', () => {
    const input = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 5 }), act('M', { type: 'start_milestone', originalDuration: 0 })],
      [dep('AM', 'A', 'M')],
    )
    const r = run(input)
    expect(r.late.get('M')).toEqual({ ls: startOf('2026-03-09'), lf: startOf('2026-03-09'), kind: 'start' })
    expect(r.showLate('M')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
    expect(r.tf('M')).toBe(0)
  })

  it("finish_milestone feeding B FS: late moment from the successor, kind 'finish'", () => {
    const input = prog(
      [act('A', { originalDuration: 5 }), act('M', { type: 'finish_milestone', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('AM', 'A', 'M'), dep('MB', 'M', 'B')],
    )
    const r = run(input)
    expect(r.late.get('M')!.kind).toBe('finish')
    expect(r.showLate('M')).toEqual({ start: '2026-03-06', finish: '2026-03-06' })
    expect(r.tf('M')).toBe(0)
  })
})

describe('ruling 4', () => {
  it('(a) a lone finish_milestone at the project start shows its late date 03-02', () => {
    const r = run(prog([act('M', { type: 'finish_milestone', originalDuration: 0 })]))
    expect(r.late.get('M')!.kind).toBe('start')
    expect(r.showLate('M')).toEqual({ start: '2026-03-02', finish: '2026-03-02' })
    expect(r.tf('M')).toBe(0)
  })

  it("(a) finish_milestone M SS B(3): late moment from the SS reverse, kind 'start', shows 03-02, TF 0", () => {
    const r = run(prog(
      [act('M', { type: 'finish_milestone', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('MB', 'M', 'B', { type: 'SS' })],
    ))
    expect(r.late.get('M')!.kind).toBe('start')
    expect(r.showLate('M')).toEqual({ start: '2026-03-02', finish: '2026-03-02' })
    expect(r.tf('M')).toBe(0)
  })

  it('(b) A(5) SS B(2), B its only successor: A late finish is capped at the project finish 03-06, TF 0', () => {
    // projectFinish = end 03-06 (A). B late 03-05..03-06, so the SS reverse alone would let A finish 03-11.
    const r = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 2 })], [dep('L', 'A', 'B', { type: 'SS' })]))
    expect(r.showLate('B')).toEqual({ start: '2026-03-05', finish: '2026-03-06' })
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.tf('A')).toBe(0)
  })

  it('(c) D FNLT 03-11: raw free float 2 is capped at total float 1', () => {
    const r = run(network({ D: { constraint: { type: 'fnlt', date: '2026-03-11' } } }))
    expect(r.tf('D')).toBe(1)
    expect(r.ff('D')).toBe(1)
  })

  it('(c) D FNLT 03-09: total float -1 caps free float at 0', () => {
    const r = run(network({ D: { constraint: { type: 'fnlt', date: '2026-03-09' } } }))
    expect(r.tf('D')).toBe(-1)
    expect(r.ff('D')).toBe(0)
  })

  it('(d) C ALAP: C shows 03-11 and its FS successor D is re-flowed to 03-12; late dates unchanged', () => {
    const r = run(network({ C: { constraint: { type: 'alap', date: null } } }), { alap: true })
    expect(r.showEarly('C')).toEqual({ start: '2026-03-11', finish: '2026-03-11' })
    expect(r.showEarly('D')).toEqual({ start: '2026-03-12', finish: '2026-03-12' })
    expect(r.showEarly('B')).toEqual({ start: '2026-03-09', finish: '2026-03-12' })
    expect(r.showLate('D')).toEqual({ start: '2026-03-12', finish: '2026-03-12' })
  })
})

describe('ruling 5 and lags (fix round 1)', () => {
  it('5(a) C ALAP with D FNLT 03-09 (C TF −1): C is held at its early 03-09, D re-flows to 03-10', () => {
    const r = run(network({
      C: { constraint: { type: 'alap', date: null } },
      D: { constraint: { type: 'fnlt', date: '2026-03-09' } },
    }), { alap: true })
    expect(r.showEarly('C')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
    expect(r.showEarly('D')).toEqual({ start: '2026-03-10', finish: '2026-03-10' })
    expect(r.tf('C')).toBe(-1)
  })

  it('5(b) C ALAP: floats come from the pre-ALAP early dates — C TF 2 FF 0, D TF 2 FF 2 (not critical at 0)', () => {
    const r = run(network({ C: { constraint: { type: 'alap', date: null } } }), { alap: true })
    expect(r.tf('C')).toBe(2)
    expect(r.ff('C')).toBe(0)
    expect(r.tf('D')).toBe(2)
    expect(r.ff('D')).toBe(2)
  })

  it('freeFloats gives every leaf its free float in one pass', () => {
    const r = run(network())
    expect(freeFloats(r.n, r.input, r.cals, r.early, r.late, r.projectFinish)).toEqual(new Map([['A', 0], ['B', 0], ['C', 0], ['D', 2]]))
  })

  // A(5) FS B(3) with the lag under test; X(13) runs alone and sets projectFinish (end of Wed 03-18),
  // so B has float and A's late finish comes from the reversed lag.
  const S6 = { id: 'S6', workWeekdays: [1, 2, 3, 4, 5, 6], hoursPerDay: 8, nonWorkDates: [], workDates: [], coverage: { from: '2026-01-01', to: '2027-12-31' } }
  const lagNet = (link: Partial<DependencyInput>, bCal: string | null = null): ProgrammeInput => {
    const base = prog(
      [act('A', { originalDuration: 5 }), act('B', { originalDuration: 3, calendarId: bCal }), act('X', { originalDuration: 13 })],
      [dep('AB', 'A', 'B', link)],
    )
    return bCal ? { ...base, calendars: [...base.calendars, S6] } : base
  }
  const lateA = (input: ProgrammeInput) => {
    const r = run(input)
    return { lf: r.late.get('A')!.lf, shown: r.showLate('A').finish, tf: r.tf('A') }
  }

  it('FS +2 working: A late finish = end of Wed 03-11, TF 3', () => {
    expect(lateA(lagNet({ lag: 2 }))).toEqual({ lf: startOf('2026-03-12'), shown: '2026-03-11', tf: 3 })
  })

  it('FS −2 lead: A late finish = end of Tue 03-17, TF 7', () => {
    expect(lateA(lagNet({ lag: -2 }))).toEqual({ lf: startOf('2026-03-18'), shown: '2026-03-17', tf: 7 })
  })

  it('FS +2 elapsed: A late finish = Sat 03-14 00:00 = end of Fri 03-13, TF 5', () => {
    expect(lateA(lagNet({ lag: 2, lagUnit: 'elapsed_days' }))).toEqual({ lf: startOf('2026-03-14'), shown: '2026-03-13', tf: 5 })
  })

  it('SS 50 %: A late start Wed 03-11 noon, late finish Wed 03-18 noon, TF 7.5', () => {
    const r = run(lagNet({ type: 'SS', lag: 50, lagUnit: 'percent' }))
    expect(r.late.get('A')).toEqual({ ls: startOf('2026-03-11') + 0.5, lf: startOf('2026-03-18') + 0.5 })
    expect(r.tf('A')).toBe(7.5)
  })

  it("two calendars, FS +2 on the 'succ' calendar (B on Mon–Sat): A late finish = end of Thu 03-12, TF 4", () => {
    expect(lateA(lagNet({ lag: 2, lagCalendar: 'succ' }, 'S6'))).toEqual({ lf: startOf('2026-03-13'), shown: '2026-03-12', tf: 4 })
  })

  it("two calendars, FS +2 on the 'pred' calendar (Mon–Fri): A late finish = end of Wed 03-11, TF 3", () => {
    expect(lateA(lagNet({ lag: 2, lagCalendar: 'pred' }, 'S6'))).toEqual({ lf: startOf('2026-03-12'), shown: '2026-03-11', tf: 3 })
  })
})

describe('level of effort (ruling 1)', () => {
  it('an LOE gets placeholder late times and drives no late date', () => {
    const input = prog(
      [act('A', { originalDuration: 5 }), act('L', { type: 'level_of_effort', originalDuration: 0 }), act('B', { originalDuration: 3 })],
      [dep('AB', 'A', 'B'), dep('AL', 'A', 'L', { type: 'SS' }), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = run(input)
    expect(r.late.get('L')).toEqual({ ls: startOf('2026-03-02'), lf: startOf('2026-03-02') })
    expect(r.tf('L')).toBe(0)
    expect(r.ff('L')).toBe(0)
    expect(r.showLate('A')).toEqual({ start: '2026-03-02', finish: '2026-03-06' })
    expect(r.tf('A')).toBe(0)
  })

  it('a link to an LOE does not limit its predecessor: A keeps its 2 days of float', () => {
    // X(5) sets the project finish (end 03-06); A(2) FS B(1); A SS L, L FF B.
    const input = prog(
      [act('X', { originalDuration: 5 }), act('A', { originalDuration: 2 }), act('L', { type: 'level_of_effort', originalDuration: 0 }),
        act('B', { originalDuration: 1 })],
      [dep('AB', 'A', 'B'), dep('AL', 'A', 'L', { type: 'SS' }), dep('LB', 'L', 'B', { type: 'FF' })],
    )
    const r = run(input)
    expect(r.showLate('A')).toEqual({ start: '2026-03-04', finish: '2026-03-05' })
    expect(r.tf('A')).toBe(2)
  })
})

describe('projectFinish (ruling 12)', () => {
  it('is the greatest canonical finish: a Monday-00:00 start milestone beats Friday\'s end, with no float lost', () => {
    // A(5) ends at the Saturday 00:00 boundary; FS start_milestone S sits at Monday 00:00 (same working position).
    const r = run(prog(
      [act('A', { originalDuration: 5 }), act('S', { type: 'start_milestone', originalDuration: 0 }), act('F', { type: 'finish_milestone', originalDuration: 0 })],
      [dep('AS', 'A', 'S'), dep('AF', 'A', 'F')],
    ))
    expect(r.early.get('S')!.ef).toBe(startOf('2026-03-09'))
    // Was startOf('2026-03-07') under ruling 7(1). Ruling 12(b): numerically greatest = S at Mon 03-09 00:00.
    expect(r.projectFinish).toBe(startOf('2026-03-09'))
    expect(r.showLate('F')).toEqual({ start: '2026-03-06', finish: '2026-03-06' })
    expect(r.showLate('S')).toEqual({ start: '2026-03-09', finish: '2026-03-09' })
    expect(r.tf('F')).toBe(0)
    expect(r.tf('S')).toBe(0)
  })

  it('a later working position still wins over a smaller instant', () => {
    const r = run(prog([act('A', { originalDuration: 5 }), act('B', { originalDuration: 6 })]))
    expect(r.projectFinish).toBe(startOf('2026-03-10'))
  })
})
