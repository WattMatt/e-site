import { describe, expect, it } from 'vitest'
import { dayNumber } from '../lib/dates/calendar-date'
import {
  buildEngineCalendar, displayFinish, displayStart, engineCalendarFromProject, startOf,
} from './calendar'
import type { EngineCalendarSpec } from './types'

const spec = (over: Partial<EngineCalendarSpec> = {}): EngineCalendarSpec => ({
  id: 'C', workWeekdays: [1, 2, 3, 4, 5], hoursPerDay: 8, nonWorkDates: [], workDates: [],
  coverage: { from: '2026-01-01', to: '2027-12-31' }, ...over,
})
const C = buildEngineCalendar(spec())

describe('engine calendar', () => {
  it('finish arithmetic lands on day boundaries', () => {
    expect(C.addWork(startOf('2026-03-06'), 1, 'finish')).toBe(startOf('2026-03-07'))
    expect(displayFinish(C, startOf('2026-03-07'))).toBe('2026-03-06')
    expect(C.addWork(startOf('2026-03-06'), 2, 'finish')).toBe(startOf('2026-03-10'))
    expect(displayFinish(C, startOf('2026-03-10'))).toBe('2026-03-09')
  })
  it('skips non-work dates', () => {
    const cal = buildEngineCalendar(spec({ nonWorkDates: ['2026-03-09'] }))
    expect(cal.addWork(startOf('2026-03-06'), 2, 'finish')).toBe(startOf('2026-03-11'))
  })
  it('workBetween / fractions / snap / negative', () => {
    expect(C.workBetween(startOf('2026-03-02'), startOf('2026-03-09'))).toBe(5)
    expect(C.addWork(startOf('2026-03-02'), 0.5, 'start')).toBe(startOf('2026-03-02') + 0.5)
    expect(C.snapStart(startOf('2026-03-07'))).toBe(startOf('2026-03-09'))
    expect(C.addWork(startOf('2026-03-09'), -1, 'start')).toBe(startOf('2026-03-06'))
  })
  it('fromWorkPos on whole positions', () => {
    const pos = C.workPos(startOf('2026-03-02')) + 5
    expect(C.fromWorkPos(pos, 'start')).toBe(startOf('2026-03-09'))
    expect(C.fromWorkPos(pos, 'finish')).toBe(startOf('2026-03-07'))
  })
  it('Saturday working', () => {
    const cal = buildEngineCalendar(spec({ workWeekdays: [1, 2, 3, 4, 5, 6] }))
    expect(cal.addWork(startOf('2026-03-06'), 2, 'finish')).toBe(startOf('2026-03-08'))
  })
  it('engineCalendarFromProject: site calendar + shutdown', () => {
    const cal = buildEngineCalendar(engineCalendarFromProject('P', {
      workingDays: [1, 2, 3, 4, 5], calendar: 'site', holidays: new Set(), extraHolidays: [],
      seededYears: new Set([2026, 2027]), shutdown: { from: '2026-12-16', to: '2027-01-10' },
    }, 8, { from: '2026-01-01', to: '2027-12-31' }))
    expect(cal.addWork(startOf('2026-12-15'), 2, 'finish')).toBe(startOf('2027-01-12'))
    expect(cal.isWorkingDay(dayNumber('2026-12-19'))).toBe(false)
  })
  it('coverage', () => {
    expect(C.inCoverage(startOf('2028-01-03'))).toBe(false)
    expect(C.inCoverage(startOf('2026-06-01'))).toBe(true)
  })
  it('display helpers', () => {
    expect(displayStart(startOf('2026-03-02') + 0.5)).toBe('2026-03-02')
    expect(displayFinish(C, startOf('2026-03-02') + 0.5)).toBe('2026-03-02')
  })
  it('works far outside coverage and in both directions', () => {
    const t = startOf('2035-03-02')
    expect(C.workBetween(t, C.addWork(t, 300, 'start'))).toBe(300)
    const u = startOf('2015-03-02')
    expect(C.workBetween(u, C.addWork(u, -300, 'start'))).toBe(-300)
  })
  it('round trip for seeded random (t, n)', () => {
    let s = 12345
    const rnd = () => ((s = (s * 1664525 + 1013904223) % 4294967296) / 4294967296)
    for (let i = 0; i < 500; i++) {
      let d = startOf('2026-01-05') + Math.floor(rnd() * 600)
      while (!C.isWorkingDay(d)) d++
      const n = Math.floor(rnd() * 61) - 30
      expect(C.workBetween(d, C.addWork(d, n, 'start'))).toBe(n)
    }
  })
})
