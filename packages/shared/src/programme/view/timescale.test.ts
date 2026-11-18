import { describe, expect, it } from 'vitest'
import { barX, dateAtX, DAY_WIDTH, timescale, xOfDate, type Zoom } from './timescale'

describe('timescale', () => {
  it('pads 7 days each side and sizes the width', () => {
    const s = timescale('2026-03-02', '2026-03-31', 'day')
    expect(s.origin).toBe('2026-02-23')
    expect(s.dayWidth).toBe(36)
    expect(s.width).toBe((7 + 30 + 7) * 36)
  })
  it('day zoom: month over day-of-month', () => {
    const s = timescale('2026-03-02', '2026-03-31', 'day')
    expect(s.bands.top.map((b) => b.label)).toEqual(['Feb 2026', 'Mar 2026', 'Apr 2026'])
    expect(s.bands.top[0]).toEqual({ x: 0, width: 6 * 36, label: 'Feb 2026' })
    expect(s.bands.bottom).toHaveLength(44)
    expect(s.bands.bottom[0].label).toBe('23')
    expect(s.bands.bottom[6].label).toBe('1')
  })
  it('week zoom: month over ISO week start', () => {
    const s = timescale('2026-03-02', '2026-03-31', 'week')
    expect(s.bands.bottom[0].label).toBe('23 Feb')
    expect(s.bands.bottom[1].label).toBe('02 Mar')
    expect(s.bands.bottom[1].x).toBe(7 * 14)
    expect(s.bands.bottom[1].width).toBe(7 * 14)
    expect(s.bands.top.map((b) => b.label)).toEqual(['Feb 2026', 'Mar 2026', 'Apr 2026'])
  })
  it('month zoom: year over MMM', () => {
    const s = timescale('2026-11-15', '2027-02-10', 'month')
    expect(s.bands.top.map((b) => b.label)).toEqual(['2026', '2027'])
    expect(s.bands.bottom.map((b) => b.label)).toEqual(['Nov', 'Dec', 'Jan', 'Feb'])
  })
  it('quarter zoom: year over Q1-Q4', () => {
    const s = timescale('2026-11-15', '2027-05-10', 'quarter')
    expect(s.bands.top.map((b) => b.label)).toEqual(['2026', '2027'])
    expect(s.bands.bottom.map((b) => b.label)).toEqual(['Q4', 'Q1', 'Q2'])
  })
  it('year zoom: no top band, years below', () => {
    const s = timescale('2026-11-15', '2028-05-10', 'year')
    expect(s.bands.top).toEqual([])
    expect(s.bands.bottom.map((b) => b.label)).toEqual(['2026', '2027', '2028'])
  })
  it('bands tile the width exactly with no gaps', () => {
    for (const z of Object.keys(DAY_WIDTH) as Zoom[]) {
      const s = timescale('2026-03-02', '2028-03-31', z)
      for (const list of [s.bands.top, s.bands.bottom]) {
        if (list.length === 0) continue
        let x = 0
        for (const b of list) { expect(b.x).toBeCloseTo(x); x += b.width }
        expect(x).toBeCloseTo(s.width)
      }
    }
  })
  it('xOfDate and dateAtX round-trip at every zoom', () => {
    for (const z of Object.keys(DAY_WIDTH) as Zoom[]) {
      const s = timescale('2026-03-02', '2026-09-30', z)
      for (const d of ['2026-02-23', '2026-03-02', '2026-06-15', '2026-10-07']) {
        expect(dateAtX(s, xOfDate(s, d))).toBe(d)
      }
      expect(xOfDate(s, s.origin)).toBe(0)
    }
  })
  it('dateAtX maps any x inside a day to that day', () => {
    const s = timescale('2026-03-02', '2026-03-31', 'day')
    expect(dateAtX(s, 36 * 7 + 35.9)).toBe('2026-03-02')
    expect(dateAtX(s, 36 * 8)).toBe('2026-03-03')
  })
  it('barX: inclusive finish, 2px minimum, milestone is a point', () => {
    const s = timescale('2026-03-02', '2026-03-31', 'day')
    expect(barX(s, '2026-03-02', '2026-03-02')).toEqual({ x: 7 * 36, width: 36 })
    expect(barX(s, '2026-03-02', '2026-03-06')).toEqual({ x: 7 * 36, width: 5 * 36 })
    const y = timescale('2026-03-02', '2026-03-31', 'year')
    expect(barX(y, '2026-03-02', '2026-03-02').width).toBe(2)
    expect(barX(s, '2026-03-02', '2026-03-02', true)).toEqual({ x: 7 * 36, width: 0 })
  })
})
