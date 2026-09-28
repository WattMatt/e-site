import { describe, it, expect } from 'vitest'
import { detectDateOrder, parseLabelA, parseLabelB, parseLabelC, parseLabelGeneric, sastLocalToUtcMs, utcMsToSast } from './timestamps'

describe('SAST ↔ UTC (fixed +2, no DST)', () => {
  it('local midnight is 22:00 UTC the day before', () => {
    expect(sastLocalToUtcMs(2025, 3, 10, 0, 0, 0)).toBe(Date.UTC(2025, 2, 9, 22, 0, 0))
  })
  it('rejects impossible dates', () => {
    expect(sastLocalToUtcMs(2025, 2, 30, 0, 0, 0)).toBeNull()
    expect(sastLocalToUtcMs(2025, 13, 1, 0, 0, 0)).toBeNull()
    expect(sastLocalToUtcMs(2025, 1, 1, 24, 30, 0)).toBeNull()
  })
  it('round trips', () => {
    expect(utcMsToSast(Date.UTC(2025, 2, 9, 22, 30))).toMatchObject({ isoDate: '2025-03-10', hour: 0, minute: 30 })
  })
})

describe('per-format labels', () => {
  it('A: DD/MM/YYYY HH:MM:SS', () => {
    expect(parseLabelA('10/03/2025 00:00:00')).toEqual({ utcMs: Date.UTC(2025, 2, 9, 22, 0), was2400: false })
    expect(parseLabelA('2025-03-10 00:00:00')).toBeNull()
  })
  it('B: separate DATE and TIME; 24:00 → next day 00:00', () => {
    expect(parseLabelB('2025-10-01', '00:30:00')).toEqual({ utcMs: Date.UTC(2025, 8, 30, 22, 30), was2400: false })
    expect(parseLabelB('2025-03-10', '24:00:00')).toEqual({ utcMs: Date.UTC(2025, 2, 10, 22, 0), was2400: true })
  })
  it('C: one column', () => {
    expect(parseLabelC('2024-05-01 00:30:00')?.utcMs).toBe(Date.UTC(2024, 3, 30, 22, 30))
  })
  it('generic: honours the confirmed order', () => {
    expect(parseLabelGeneric('01/02/2025 00:30', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 30))
    expect(parseLabelGeneric('01/02/2025 00:30', 'MDY')?.utcMs).toBe(Date.UTC(2024, 11, 31, 22, 30) + 86_400_000)
    expect(parseLabelGeneric('2025-02-01T00:30', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 30))  // 4-digit year first = YMD
    expect(parseLabelGeneric('2025-02-01', 'DMY')?.utcMs).toBe(Date.UTC(2025, 0, 31, 22, 0))
  })
})

describe('detectDateOrder (file-level)', () => {
  it('a first field > 12 means DMY', () => {
    expect(detectDateOrder(['01/02/2025 00:30', '13/02/2025 00:30'])).toEqual({ order: 'DMY', ambiguous: false })
  })
  it('a second field > 12 means MDY', () => {
    expect(detectDateOrder(['02/13/2025 00:30'])).toEqual({ order: 'MDY', ambiguous: false })
  })
  it('all fields ≤ 12 is ambiguous and must be confirmed', () => {
    expect(detectDateOrder(['01/02/2025 00:30', '02/02/2025 00:30'])).toEqual({ order: null, ambiguous: true })
  })
  it('4-digit year first is YMD', () => {
    expect(detectDateOrder(['2025-02-01 00:30'])).toEqual({ order: 'YMD', ambiguous: false })
  })
  it('contradictory evidence is not guessed', () => {
    expect(detectDateOrder(['13/02/2025', '02/13/2025'])).toEqual({ order: null, ambiguous: true })
  })
})
