process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect } from 'vitest'
import { buildScheduleIcs, type IcsTask } from './ics'

const now = new Date(Date.UTC(2026, 8, 28, 21, 30, 0))
const task = (over: Partial<IcsTask> = {}): IcsTask => ({
  id: 't1', ref: 'SOLAR-1', name: 'Install modules', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, description: '', status: 'in_progress', ownerName: 'Ann Smith', ...over,
})
const unfold = (s: string) => s.replace(/\r\n /g, '')

describe('buildScheduleIcs', () => {
  const ics = buildScheduleIcs({ calendarName: 'KINGSWALK, solar', tasks: [task(), task({ id: 'm', ref: 'SOLAR-2', name: 'Go live', start: '2026-10-12', end: '2026-10-12', isMilestone: true })], now })
  it('all-day events with an exclusive DTEND, dates untouched in SAST', () => {
    expect(ics).toContain('DTSTART;VALUE=DATE:20261001\r\n')
    expect(ics).toContain('DTEND;VALUE=DATE:20261006\r\n')
    expect(ics).toContain('DTSTART;VALUE=DATE:20261012\r\nDTEND;VALUE=DATE:20261013\r\n')
  })
  it('real UTC DTSTAMP, stable UID, no VTODO status, no invented organiser', () => {
    expect(ics).toContain('DTSTAMP:20260928T213000Z\r\n')
    expect(ics).toContain('UID:solar-task-t1@e-site.live\r\n')
    expect(ics).not.toMatch(/^STATUS:/m)
    expect(ics).not.toContain('ORGANIZER')
    expect(ics).toContain('SUMMARY:SOLAR-2 Milestone: Go live\r\n')
  })
  it('escapes text and names the calendar', () => {
    expect(ics).toContain('X-WR-CALNAME:KINGSWALK\\, solar Schedule\r\n')
    const x = buildScheduleIcs({ calendarName: 'P', tasks: [task({ name: 'a, b; c\\d', description: 'line1\nline2' })], now })
    expect(unfold(x)).toContain('SUMMARY:SOLAR-1 a\\, b\\; c\\\\d')
    expect(unfold(x)).toContain('\\nline1\\nline2')
  })
  it('folds every physical line to at most 75 octets without splitting a character', () => {
    const long = 'Ω'.repeat(60) + ' commissioning of the rooftop array'
    const x = buildScheduleIcs({ calendarName: 'P', tasks: [task({ name: long })], now })
    for (const line of x.split('\r\n')) expect(new TextEncoder().encode(line).length).toBeLessThanOrEqual(75)
    expect(unfold(x)).toContain(`SUMMARY:SOLAR-1 ${long}`)
    expect(x).not.toContain('\uFFFD')
  })
  it('CRLF only, and ends with CRLF', () => {
    expect(ics.endsWith('END:VCALENDAR\r\n')).toBe(true)
    expect(ics.split('\r\n').every((l) => !l.includes('\n'))).toBe(true)
  })
  it('a lone CR (old Mac line ending) is escaped too, never a bare CR in the file', () => {
    const x = buildScheduleIcs({ calendarName: 'P', tasks: [task({ description: 'one\rtwo\r\nthree\nfour' })], now })
    expect(unfold(x)).toContain('one\\ntwo\\nthree\\nfour')
    expect(x.replace(/\r\n/g, '').includes('\r')).toBe(false)
  })
})
