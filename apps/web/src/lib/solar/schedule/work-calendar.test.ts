import { describe, it, expect } from 'vitest'
import { scheduleCalendar } from './work-calendar'

describe('scheduleCalendar', () => {
  it('uses the settings mode and covers the years the schedule spans, plus one each side', () => {
    const cal = scheduleCalendar('working', ['2026-12-20', '2027-01-10'], '2026-09-28')
    expect(cal.mode).toBe('working')
    expect(cal.holidays.has('2025-12-25')).toBe(true)
    expect(cal.holidays.has('2028-01-01')).toBe(true)
  })
  it('an empty schedule still gets today’s year', () => {
    const cal = scheduleCalendar('calendar', [], '2026-09-28')
    expect(cal.mode).toBe('calendar')
    expect(cal.holidays.has('2026-12-16')).toBe(true)
  })
})
