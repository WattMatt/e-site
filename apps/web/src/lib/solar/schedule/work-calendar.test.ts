import { describe, it, expect } from 'vitest'
import { endForDuration } from '@esite/shared'
import { scheduleCalendar } from './work-calendar'

describe('scheduleCalendar', () => {
  it('a task added in a later year skips that year’s holidays too', () => {
    const cal = scheduleCalendar('working', ['2026-10-01'], '2026-09-28')
    expect(endForDuration(cal, '2028-04-24', 5)).toBe('2028-05-02')
    expect(cal.holidays.has('2031-04-27')).toBe(true)
  })
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
