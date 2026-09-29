import { describe, it, expect } from 'vitest'
import { calendarFromRows, pickCalendar, resolveStudyCalendar, validateTouWindows, windowGrid, minutesLabel, parseTimeLabel, type TouCalendarRow } from './calendar'

const row = (p: Partial<TouCalendarRow>): TouCalendarRow => ({
  id: 'c', licenseeId: 'l', validFrom: '2025-04-01', validTo: null, highSeasonMonths: [6, 7, 8], source: 'published', holidayTreatedAs: 'sunday', ...p,
})

describe('calendar helpers', () => {
  it('builds the engine calendar from rows', () => {
    const cal = calendarFromRows(row({}), [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }])
    expect(cal).toEqual({ highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'published',
      windows: [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }] })
  })
  it('picks the calendar valid on a date (latest start wins)', () => {
    const rows = [row({ id: 'old', validFrom: '2024-04-01', validTo: '2025-04-01' }), row({ id: 'new', validFrom: '2025-04-01' })]
    expect(pickCalendar(rows, '2025-03-31')?.id).toBe('old')
    expect(pickCalendar(rows, '2026-01-01')?.id).toBe('new')
    expect(pickCalendar(rows, '2020-01-01')).toBeNull()
  })
  it('falls back to Eskom hours flagged assumed_eskom when the licensee has no calendar', () => {
    const eskom = calendarFromRows(row({}), [])
    expect(resolveStudyCalendar(null, eskom)).toEqual({ calendar: { ...eskom, source: 'assumed_eskom' }, assumedEskom: true, fromEskomFallback: true })
    const own = calendarFromRows(row({ source: 'assumed_eskom' }), [])
    expect(resolveStudyCalendar(own, eskom)).toEqual({ calendar: own, assumedEskom: true, fromEskomFallback: false })
    expect(resolveStudyCalendar(null, null)).toEqual({ calendar: null, assumedEskom: false, fromEskomFallback: false })
  })
  it('flags overlapping windows, per season and day type', () => {
    const issues = validateTouWindows([
      { season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 540, period: 'peak' },
      { season: 'high', dayType: 'weekday', startMinute: 480, endMinute: 600, period: 'standard' },
      { season: 'low', dayType: 'weekday', startMinute: 480, endMinute: 600, period: 'standard' },
    ])
    expect(issues).toEqual([{ season: 'high', dayType: 'weekday', message: 'High season weekday: 06:00-09:00 overlaps 08:00-10:00' }])
  })
  it('grids half-hour slots for the diagram (uncovered = off-peak)', () => {
    const cal = calendarFromRows(row({}), [{ season: 'high', dayType: 'weekday', startMinute: 360, endMinute: 480, period: 'peak' }])
    const g = windowGrid(cal).find((x) => x.season === 'high' && x.dayType === 'weekday')!
    expect(g.slots).toHaveLength(48)
    expect(g.slots[11]).toBe('off_peak')
    expect(g.slots[12]).toBe('peak')
    expect(g.slots[15]).toBe('peak')
    expect(g.slots[16]).toBe('off_peak')
  })
  it('time labels round-trip', () => {
    expect(minutesLabel(390)).toBe('06:30')
    expect(minutesLabel(1440)).toBe('24:00')
    expect(parseTimeLabel('06:30')).toBe(390)
    expect(parseTimeLabel('24:00')).toBe(1440)
    expect(parseTimeLabel('25:00')).toBeNull()
  })
})
