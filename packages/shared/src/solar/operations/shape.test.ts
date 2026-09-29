import { describe, it, expect } from 'vitest'
import { expectedKwhBetween, hourShare } from './shape'
import { monthEndMs, monthStartMs } from './time'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const full = () => 1000

describe('shaped expectation (not a flat per-slot figure, WM G14)', () => {
  it('a whole month sums to the month expectation', () => {
    expect(expectedKwhBetween(b, full, monthStartMs('2026-03'), monthEndMs('2026-03'))).toBeCloseTo(1000, 6)
  })
  it('night hours expect nothing; a producing hour expects its share', () => {
    expect(hourShare(b, '2026-03', 2)).toBe(0)
    expect(hourShare(b, '2026-03', 11)).toBeCloseTo(1 / (4 * 31), 9)
    const t0 = Date.parse('2026-03-10T11:00:00+02:00')
    expect(expectedKwhBetween(b, full, t0, t0 + 3_600_000)).toBeCloseTo(1000 / (4 * 31), 6)
    expect(expectedKwhBetween(b, full, t0 - 9 * 3_600_000, t0 - 8 * 3_600_000)).toBe(0)
  })
  it('splits partial hours and crosses month boundaries with each month’s own kWh', () => {
    const t0 = Date.parse('2026-03-10T11:15:00+02:00')
    expect(expectedKwhBetween(b, full, t0, t0 + 30 * 60_000)).toBeCloseTo(0.5 * 1000 / (4 * 31), 6)
    const perMonth = (k: string) => (k === '2026-03' ? 1000 : 2000)
    const total = expectedKwhBetween(b, perMonth, monthStartMs('2026-03'), monthEndMs('2026-04'))
    expect(total).toBeCloseTo(3000, 6)
  })
  it('an empty or inverted window is zero', () => {
    expect(expectedKwhBetween(b, full, 10, 10)).toBe(0)
    expect(expectedKwhBetween(b, full, 20, 10)).toBe(0)
  })
})
