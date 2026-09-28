import { describe, it, expect } from 'vitest'
import { criticalPath, type CpmTask } from './cpm'
import { findCycle, linkWouldCycle, topoOrder, linkKey, type ScheduleLink } from './graph'
import { makeWorkCalendar, saHolidaySet } from './calendar'

const cal = makeWorkCalendar('calendar')
const wcal = makeWorkCalendar('working', saHolidaySet(2026, 2026))
const t = (id: string, start: string, end: string, isMilestone = false): CpmTask => ({ id, start, end, isMilestone })
const link = (p: string, s: string, type: ScheduleLink['type'] = 'FS', lagDays = 0): ScheduleLink =>
  ({ predecessorId: p, successorId: s, type, lagDays })

function ok(r: ReturnType<typeof criticalPath>) {
  if (!r.ok) throw new Error(`unexpected cycle ${r.cycle.join(',')}`)
  return r
}

describe('graph', () => {
  it('orders predecessors first and ignores links to unknown tasks', () => {
    const r = topoOrder(['a', 'b', 'c'], [link('b', 'c'), link('a', 'b'), link('x', 'a')])
    expect(r).toEqual({ ok: true, order: ['a', 'b', 'c'] })
  })
  it('names the tasks in a loop', () => {
    const c = findCycle(['a', 'b', 'c'], [link('a', 'b'), link('b', 'c'), link('c', 'a')])
    expect(new Set(c)).toEqual(new Set(['a', 'b', 'c']))
    expect(findCycle(['a', 'b'], [link('a', 'b')])).toBeNull()
  })
  it('refuses a self link and a closing link before it is saved', () => {
    expect(linkWouldCycle(['a'], [], link('a', 'a'))).toBe(true)
    expect(linkWouldCycle(['a', 'b'], [link('a', 'b')], link('b', 'a'))).toBe(true)
    expect(linkWouldCycle(['a', 'b', 'c'], [link('a', 'b')], link('a', 'c'))).toBe(false)
  })
})

describe('criticalPath — no links', () => {
  it('marks every task that finishes on the programme end, not just the longest (WM’s bug)', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-10'), t('B', '2026-10-01', '2026-10-20'), t('C', '2026-10-15', '2026-10-20')], [], cal))
    expect(r.critical).toEqual(new Set(['B', 'C']))
    expect(r.totalFloat.get('A')).toBe(10)
    expect(r.lengthDays).toBe(20)
  })
  it('an empty schedule has no critical path and length 0', () => {
    const r = ok(criticalPath([], [], cal))
    expect(r.critical.size).toBe(0)
    expect(r.lengthDays).toBe(0)
  })
})

describe('criticalPath — FS with lag', () => {
  const tasks = [t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-08', '2026-10-10')]
  it('lag 2 makes the gap tight, so A is critical (WM ignored lag and said it was not)', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B', 'FS', 2)], cal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
    expect(r.criticalLinks).toEqual(new Set([linkKey(link('A', 'B'))]))
    expect(r.violations).toEqual([])
  })
  it('lag 1 leaves A one day of float', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B', 'FS', 1)], cal))
    expect(r.totalFloat.get('A')).toBe(1)
    expect(r.critical.has('A')).toBe(false)
  })
})

describe('criticalPath — SS, FF, SF', () => {
  it('SS lag 2: A drives B’s start', () => {
    const tasks = [t('A', '2026-10-01', '2026-10-03'), t('B', '2026-10-03', '2026-10-10')]
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SS', 2)], cal)).totalFloat.get('A')).toBe(0)
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SS', 1)], cal)).totalFloat.get('A')).toBe(1)
    // Read as FS (WM): B would start before A finished — a violation that SS does not have.
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FS', 0)], cal)).violations).toHaveLength(1)
  })
  it('FF lag 2: A must finish 2 days before B finishes', () => {
    const tasks = [t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-02', '2026-10-07')]
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FF', 2)], cal)).totalFloat.get('A')).toBe(0)
    expect(ok(criticalPath(tasks, [link('A', 'B', 'FF', 0)], cal)).totalFloat.get('A')).toBe(2)
  })
  it('SF lag 3: B cannot finish until 3 days after A starts', () => {
    const tasks = [t('A', '2026-10-03', '2026-10-04'), t('B', '2026-10-01', '2026-10-05')]
    const r = ok(criticalPath(tasks, [link('A', 'B', 'SF', 3)], cal))
    expect(r.totalFloat.get('A')).toBe(0)
    expect(r.violations).toEqual([])
    expect(ok(criticalPath(tasks, [link('A', 'B', 'SF', 2)], cal)).totalFloat.get('A')).toBe(1)
  })
})

describe('criticalPath — working days and holidays', () => {
  const tasks = [t('A', '2026-09-21', '2026-09-23'), t('B', '2026-09-25', '2026-09-25')]
  it('Heritage Day (Thu 24 Sep) closes the gap in working mode', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B')], wcal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
    expect(r.lengthDays).toBe(4)
  })
  it('in calendar mode the holiday is a day of float', () => {
    const r = ok(criticalPath(tasks, [link('A', 'B')], cal))
    expect(r.totalFloat.get('A')).toBe(1)
    expect(r.lengthDays).toBe(5)
  })
  it('a weekend gap is tight in working mode', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-02'), t('B', '2026-10-05', '2026-10-06')], [link('A', 'B')], wcal))
    expect(r.critical).toEqual(new Set(['A', 'B']))
  })
})

describe('criticalPath — milestones, violations, cycles', () => {
  it('a milestone ON its predecessor’s finish date is tight (end of day, as MS Project places it)', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-09'), t('M', '2026-10-09', '2026-10-09', true)], [link('A', 'M')], cal))
    expect(r.critical).toEqual(new Set(['A', 'M']))
    expect(r.violations).toEqual([])
  })
  it('a milestone the day after its predecessor ends has one day of float', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-09'), t('M', '2026-10-10', '2026-10-10', true), t('Z', '2026-10-01', '2026-10-10')], [link('A', 'M')], cal))
    expect(r.totalFloat.get('A')).toBe(1)
    expect(r.violations).toEqual([])
  })
  // MS Project shape: task Mon–Fri, milestone on the Friday (FS), successor on Monday (FS).
  const msp = [t('A', '2026-10-05', '2026-10-09'), t('M', '2026-10-09', '2026-10-09', true), t('B', '2026-10-12', '2026-10-14')]
  const mspLinks = [link('A', 'M'), link('M', 'B')]
  it('MS Project milestone chain, working mode: all critical, no violations', () => {
    const r = ok(criticalPath(msp, mspLinks, wcal))
    expect(r.violations).toEqual([])
    expect(r.critical).toEqual(new Set(['A', 'M', 'B']))
    expect(r.criticalLinks).toEqual(new Set(mspLinks.map(linkKey)))
  })
  it('MS Project milestone chain, calendar mode: no violations; the weekend is the only float', () => {
    const r = ok(criticalPath(msp, mspLinks, cal))
    expect(r.violations).toEqual([])
    expect(r.critical).toEqual(new Set(['B']))
    expect(r.totalFloat.get('M')).toBe(2)
    const sat = ok(criticalPath([msp[0], msp[1], t('B', '2026-10-10', '2026-10-12')], mspLinks, cal))
    expect(sat.violations).toEqual([])
    expect(sat.critical).toEqual(new Set(['A', 'M', 'B']))
  })
  it('a milestone on a predecessor’s finish in working mode across a holiday is tight', () => {
    // Heritage Day Thu 24 Sep 2026: A Mon–Wed, M Wed, B Fri.
    const r = ok(criticalPath([t('A', '2026-09-21', '2026-09-23'), t('M', '2026-09-23', '2026-09-23', true), t('B', '2026-09-25', '2026-09-25')], [link('A', 'M'), link('M', 'B')], wcal))
    expect(r.violations).toEqual([])
    expect(r.critical).toEqual(new Set(['A', 'M', 'B']))
  })
  it('a plan that breaks a link has negative float and a listed violation', () => {
    const r = ok(criticalPath([t('A', '2026-10-01', '2026-10-05'), t('B', '2026-10-03', '2026-10-06')], [link('A', 'B')], cal))
    expect(r.totalFloat.get('A')).toBe(-3)
    expect(r.critical.has('A')).toBe(true)
    expect(r.violations).toEqual([{ link: link('A', 'B'), shortByDays: 3 }])
  })
  it('reports a loop instead of silently returning nothing (WM)', () => {
    const r = criticalPath([t('A', '2026-10-01', '2026-10-02'), t('B', '2026-10-03', '2026-10-04')], [link('A', 'B'), link('B', 'A')], cal)
    expect(r.ok).toBe(false)
    if (!r.ok) expect(new Set(r.cycle)).toEqual(new Set(['A', 'B']))
  })
})
