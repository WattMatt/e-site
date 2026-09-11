// packages/shared/src/lib/jbcc/sa-public-holidays.test.ts
import { describe, it, expect } from 'vitest'
import { isPublicHoliday, listHolidays, listHolidaysNamed } from './sa-public-holidays'

describe('SA public holidays', () => {
  it('flags fixed-date holidays', () => {
    expect(isPublicHoliday(new Date('2026-01-01'))).toBe(true) // New Year
    expect(isPublicHoliday(new Date('2026-03-21'))).toBe(true) // Human Rights
    expect(isPublicHoliday(new Date('2026-04-27'))).toBe(true) // Freedom
    expect(isPublicHoliday(new Date('2026-05-01'))).toBe(true) // Workers
    expect(isPublicHoliday(new Date('2026-06-16'))).toBe(true) // Youth
    expect(isPublicHoliday(new Date('2026-09-24'))).toBe(true) // Heritage
    expect(isPublicHoliday(new Date('2026-12-16'))).toBe(true) // Reconciliation
    expect(isPublicHoliday(new Date('2026-12-25'))).toBe(true) // Christmas
    expect(isPublicHoliday(new Date('2026-12-26'))).toBe(true) // Day of Goodwill
  })

  it('computes Easter-derived holidays (2026: Easter Sun = Apr 5)', () => {
    expect(isPublicHoliday(new Date('2026-04-03'))).toBe(true) // Good Friday
    expect(isPublicHoliday(new Date('2026-04-06'))).toBe(true) // Family Day
  })

  it("applies the Sunday rule (Women's Day 2026 falls on Sun 9 Aug)", () => {
    expect(isPublicHoliday(new Date('2026-08-09'))).toBe(true)  // gazetted Sun
    expect(isPublicHoliday(new Date('2026-08-10'))).toBe(true)  // observed Mon
  })

  it('does not flag ordinary weekdays', () => {
    expect(isPublicHoliday(new Date('2026-06-15'))).toBe(false) // Mon before Youth Day
    expect(isPublicHoliday(new Date('2026-07-04'))).toBe(false)
  })

  it('listHolidays(2026) returns at least 12 dates', () => {
    expect(listHolidays(2026).length).toBeGreaterThanOrEqual(12)
  })
})

const iso = (d: Date) => d.toISOString().slice(0, 10)

describe('listHolidaysNamed', () => {
  it('carries a name for every date listHolidays returns, in the same order', () => {
    const named = listHolidaysNamed(2026)
    const plain = listHolidays(2026)
    expect(named.map((h) => iso(h.date))).toEqual(plain.map(iso))
    expect(named.every((h) => h.name.length > 0)).toBe(true)
  })

  it('names the computed Easter pair', () => {
    const byDate = new Map(listHolidaysNamed(2026).map((h) => [iso(h.date), h.name]))
    expect(byDate.get('2026-04-03')).toBe('Good Friday')
    expect(byDate.get('2026-04-06')).toBe('Family Day')
  })

  it('marks a Sunday-rule Monday as observed rather than duplicating the name', () => {
    // 9 August 2026 (National Women's Day) falls on a Sunday.
    const byDate = new Map(listHolidaysNamed(2026).map((h) => [iso(h.date), h.name]))
    expect(byDate.get('2026-08-09')).toBe("National Women's Day")
    expect(byDate.get('2026-08-10')).toBe("National Women's Day (observed)")
  })

  it('emits no duplicate dates in any year from 2024 to 2035', () => {
    for (let y = 2024; y <= 2035; y++) {
      const dates = listHolidaysNamed(y).map((h) => iso(h.date))
      expect(new Set(dates).size, `duplicate date in ${y}`).toBe(dates.length)
    }
  })

  it('collapses the 2033 Christmas-observed/Day-of-Goodwill collision to one row', () => {
    // Christmas Day 2033-12-25 is a Sunday; its observed Monday would land on
    // 2033-12-26, which is already Day of Goodwill. One date, one row.
    const named = listHolidaysNamed(2033).filter((h) => iso(h.date) === '2033-12-26')
    expect(named).toHaveLength(1)
    expect(named[0].name).toBe('Day of Goodwill')
  })
})

describe('the refactor does not move listHolidays', () => {
  // Measured against the pre-refactor implementation on 2026-09-10. Thirteen
  // entries: ten fixed dates, Good Friday, Family Day, and ONE observance
  // (2026-08-10). 21 March 2026 is a SATURDAY, so it generates none.
  it('still returns the same dates in the same order for 2026', () => {
    expect(listHolidays(2026).map(iso)).toEqual([
      '2026-01-01', '2026-03-21', '2026-04-27', '2026-05-01', '2026-06-16',
      '2026-08-09', '2026-09-24', '2026-12-16', '2026-12-25', '2026-12-26',
      '2026-04-03', '2026-04-06', '2026-08-10',
    ])
  })

  // 159, not the plan's 160 — 2033-12-26 was counted twice by the pre-refactor
  // Sunday rule (Christmas observed = Day of Goodwill); one date, one row.
  it('still yields exactly 105 dates across 2024-2031 and 159 across 2024-2035', () => {
    const count = (from: number, to: number) => {
      let n = 0
      for (let y = from; y <= to; y++) n += listHolidays(y).length
      return n
    }
    expect(count(2024, 2031)).toBe(105)
    expect(count(2024, 2035)).toBe(159)
  })
})
