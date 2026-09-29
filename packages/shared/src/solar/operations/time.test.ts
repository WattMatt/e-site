import { describe, it, expect } from 'vitest'
import {
  addMonths, daysInMonth, isMonthKey, isoToSastLocal, monthEndMs, monthKeyOfMs, monthLabel, monthRange, monthStartMs,
  monthsBetween, sastLocalToIso, sastMidnightMs, sastParts,
} from './time'

describe('SAST calendar helpers', () => {
  it('a month starts at SAST midnight', () => {
    expect(monthStartMs('2026-03')).toBe(Date.parse('2026-03-01T00:00:00+02:00'))
    expect(monthEndMs('2026-12')).toBe(Date.parse('2027-01-01T00:00:00+02:00'))
  })
  it('an instant belongs to its SAST month (22:30 UTC on 31 Dec is already January in SAST)', () => {
    expect(monthKeyOfMs(Date.parse('2025-12-31T21:59:00Z'))).toBe('2025-12')
    expect(monthKeyOfMs(Date.parse('2025-12-31T22:00:00Z'))).toBe('2026-01')
  })
  it('adds and counts months across years in both directions', () => {
    expect(addMonths('2026-01', -1)).toBe('2025-12')
    expect(addMonths('2025-11', 14)).toBe('2027-01')
    expect(monthsBetween('2025-11', '2026-02')).toBe(3)
    expect(monthRange('2025-11', '2026-02')).toEqual(['2025-11', '2025-12', '2026-01', '2026-02'])
    expect(monthRange('2026-02', '2025-11')).toEqual([])
  })
  it('knows leap Februaries', () => {
    expect(daysInMonth(2028, 2)).toBe(29)
    expect(daysInMonth(2026, 2)).toBe(28)
  })
  it('splits an instant into SAST parts', () => {
    expect(sastParts(Date.parse('2026-06-21T04:30:00Z'))).toEqual({ year: 2026, month: 6, day: 21, hour: 6, minute: 30 })
    expect(sastMidnightMs('2026-02-15')).toBe(Date.parse('2026-02-15T00:00:00+02:00'))
  })
  it('validates and labels month keys', () => {
    expect(isMonthKey('2026-03')).toBe(true)
    expect(isMonthKey('2026-13')).toBe(false)
    expect(isMonthKey('2026-3')).toBe(false)
    expect(monthLabel('2026-03')).toBe('March 2026')
  })
  it('reads a datetime-local value as SAST and back', () => {
    expect(sastLocalToIso('2026-03-10T10:00')).toBe('2026-03-10T08:00:00.000Z')
    expect(sastLocalToIso('2026-02-30T10:00')).toBeNull()
    expect(sastLocalToIso('10:00')).toBeNull()
    expect(isoToSastLocal('2026-03-10T08:00:00.000Z')).toBe('2026-03-10T10:00')
  })
})
