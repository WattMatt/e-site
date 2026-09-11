import { describe, it, expect } from 'vitest'
import { listHolidaysNamed } from '../jbcc/sa-public-holidays'
import { buildCalendar, workingDaysBetween, addWorkingDays, type ProjectCalendar } from './working-days'

const seeded = (years: number[]) => {
  const holidays = new Set<string>()
  for (const y of years) for (const h of listHolidaysNamed(y)) holidays.add(h.date.toISOString().slice(0, 10))
  return { holidays, seededYears: new Set(years) }
}

const cal = (over: Partial<ProjectCalendar> = {}): ProjectCalendar =>
  buildCalendar({
    workingDays: [1, 2, 3, 4, 5],
    extraHolidays: [],
    calendar: 'office',
    ...seeded([2026, 2027]),
    ...over,
  })

describe('workingDaysBetween — office', () => {
  it('counts a plain Mon→Fri week as 4', () => {
    // 2026-06-01 is a Monday; 2026-06-05 the Friday.
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-05T08:00:00Z'), cal())).toBe(4)
  })

  it('skips a public holiday', () => {
    // 16 June 2026 (Youth Day) is a Tuesday. Mon 15th → Wed 17th is 1 working day.
    expect(workingDaysBetween(new Date('2026-06-15T08:00:00Z'), new Date('2026-06-17T08:00:00Z'), cal())).toBe(1)
  })

  it('skips an extra_holidays date the project added', () => {
    const c = cal({ extraHolidays: ['2026-06-03'] })
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-05T08:00:00Z'), c)).toBe(3)
  })

  it('returns 0 when to <= from', () => {
    expect(workingDaysBetween(new Date('2026-06-05T08:00:00Z'), new Date('2026-06-01T08:00:00Z'), cal())).toBe(0)
  })

  it('returns 0 for two instants on the same local day', () => {
    expect(workingDaysBetween(new Date('2026-06-01T06:00:00Z'), new Date('2026-06-01T15:00:00Z'), cal())).toBe(0)
  })
})

describe('workingDaysBetween — site', () => {
  it('counts Saturday when the working week does not already include it', () => {
    // 2026-06-01 Mon → 2026-06-08 Mon: office = 5, site = 6 (adds Sat the 6th).
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), cal())).toBe(5)
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), cal({ calendar: 'site' }))).toBe(6)
  })

  it('does not double-count Saturday for a project that already works Saturdays', () => {
    const c = cal({ workingDays: [1, 2, 3, 4, 5, 6], calendar: 'site' })
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), c)).toBe(6)
  })

  it('an extra_holidays date removes even the Saturday the site rule added', () => {
    // Mon 1 → Mon 8 June 2026 on site = 6; Sat 6 June declared an extra holiday → 5.
    const c = cal({ extraHolidays: ['2026-06-06'], calendar: 'site' })
    expect(workingDaysBetween(new Date('2026-06-01T08:00:00Z'), new Date('2026-06-08T08:00:00Z'), c)).toBe(5)
  })
})

describe('the shutdown window belongs to the due-date rule, not the count', () => {
  it('workingDaysBetween ignores the shutdown window (parity with projects.working_days_between)', () => {
    // Mon 14 Dec 2026 → Mon 21 Dec 2026 on site: Tue 15, Thu 17, Fri 18, Sat 19,
    // Mon 21 = 5 (Wed 16 is Day of Reconciliation). Every one of those days sits
    // inside the shutdown and the count must still see them: the SQL function
    // has no shutdown arm, and the two must agree on elapsed working days.
    const c = cal({ shutdown: { from: '2026-12-15', to: '2027-01-15' }, calendar: 'site' })
    expect(workingDaysBetween(new Date('2026-12-14T08:00:00Z'), new Date('2026-12-21T08:00:00Z'), c)).toBe(5)
  })
})

describe('the Africa/Johannesburg cast', () => {
  // SAST is UTC+2 with no DST, so the UTC date runs BEHIND the local date. The
  // misclassification window is 00:00-02:00 SAST. A fixture built at 22:30
  // passes under the correct and the incorrect cast alike and is decorative.
  it('treats 00:30 SAST as the local day, not the previous UTC day', () => {
    // 2026-06-02T22:30Z is 2026-06-03 00:30 SAST — a Wednesday locally.
    const from = new Date('2026-06-01T08:00:00Z')      // Mon
    const to = new Date('2026-06-02T22:30:00Z')        // Wed 00:30 SAST
    expect(workingDaysBetween(from, to, cal())).toBe(2)
  })
})

describe('unseeded years raise rather than silently drifting', () => {
  it('throws when either bound falls in a year with no calendar row', () => {
    expect(() => workingDaysBetween(new Date('2029-01-05T08:00:00Z'), new Date('2029-01-12T08:00:00Z'), cal()))
      .toThrow(/not seeded/i)
  })
})

describe('addWorkingDays', () => {
  it('lands on the first office working day after Youth Day', () => {
    // Mon 15 June 2026 + 1 working day = Wed 17 June (Tue 16th is Youth Day).
    expect(addWorkingDays(new Date('2026-06-15T08:00:00Z'), 1, cal()).toISOString().slice(0, 10)).toBe('2026-06-17')
  })

  it('pushes a due date landing inside the builders shutdown to the new year', () => {
    const c = cal({ shutdown: { from: '2026-12-15', to: '2027-01-15' }, calendar: 'site' })
    const due = addWorkingDays(new Date('2026-12-10T08:00:00Z'), 10, c)
    expect(due.toISOString().slice(0, 10) > '2027-01-15').toBe(true)
  })
})
