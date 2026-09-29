import { describe, it, expect } from 'vitest'
import { lostHourlyKwh, lostKwh, lostSteps, referenceHourIndex } from './lost-energy'
import { flatBaseline } from './__fixtures__/baseline'

const b = flatBaseline()
const full = () => 1240 // 10 kWh per producing hour in March (4 h × 31 d = 124 h)
const at = (iso: string) => Date.parse(iso)

describe('lost energy = shaped expected minus actual, per interval', () => {
  it('a full outage loses the whole shaped expectation', () => {
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T13:00:00+02:00') }, [], b, full)
    expect(steps).toHaveLength(4)
    expect(lostKwh(steps)).toBeCloseTo(20, 6)
  })
  it('partial production is subtracted; over-production never makes loss negative', () => {
    const pts = [
      { endMs: at('2026-03-10T11:30:00+02:00'), kw: 4, intervalMin: 30 }, // 2 kWh of 5 expected
      { endMs: at('2026-03-10T12:00:00+02:00'), kw: 30, intervalMin: 30 }, // 15 kWh ≥ 5 expected
    ]
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T12:00:00+02:00') }, pts, b, full)
    expect(steps.map((s) => s.lostKwh)).toEqual([3, 0])
  })
  it('a window off the data grid counts recorded output by overlap (review B2)', () => {
    // Plant steady at the expected 10 kW, 30-minute data ending 10:30 … 14:00; manual window 10:10–13:10.
    const pts = Array.from({ length: 8 }, (_, k) => ({ endMs: at('2026-03-10T10:30:00+02:00') + k * 1_800_000, kw: 10, intervalMin: 30 }))
    const steps = lostSteps({ startMs: at('2026-03-10T10:10:00+02:00'), endMs: at('2026-03-10T13:10:00+02:00') }, pts, b, full)
    expect(steps.reduce((s, x) => s + x.expectedKwh, 0)).toBeCloseTo(30, 6)
    expect(steps.reduce((s, x) => s + x.actualKwh, 0)).toBeCloseTo(30, 6)
    expect(lostKwh(steps)).toBeCloseTo(0, 6)
  })
  it('sums meters on different intervals instead of collapsing points that share an end time (review B2)', () => {
    // Meter A: 30-min, 6 kW. Meter B: 15-min, 4 kW. Together 10 kW = the expectation, so nothing is lost.
    const a = Array.from({ length: 4 }, (_, k) => ({ endMs: at('2026-03-10T10:30:00+02:00') + k * 1_800_000, kw: 6, intervalMin: 30 }))
    const bb = Array.from({ length: 8 }, (_, k) => ({ endMs: at('2026-03-10T10:15:00+02:00') + k * 900_000, kw: 4, intervalMin: 15 }))
    const steps = lostSteps({ startMs: at('2026-03-10T10:00:00+02:00'), endMs: at('2026-03-10T12:00:00+02:00') }, [...a, ...bb], b, full)
    expect(steps.reduce((s, x) => s + x.actualKwh, 0)).toBeCloseTo(20, 6)
    expect(lostKwh(steps)).toBeCloseTo(0, 6)
  })
  it('uses the data’s own interval for the step', () => {
    const pts = [{ endMs: at('2026-03-10T11:15:00+02:00'), kw: 0, intervalMin: 15 }]
    expect(lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T12:00:00+02:00') }, pts, b, full)).toHaveLength(4)
  })
})

describe('the bill engine’s 365-day hour index (29 Feb dropped)', () => {
  it('maps SAST times; 29 February folds onto 28 February', () => {
    expect(referenceHourIndex(at('2026-01-01T00:30:00+02:00'))).toBe(0)
    expect(referenceHourIndex(at('2026-03-01T10:00:00+02:00'))).toBe(59 * 24 + 10)
    expect(referenceHourIndex(at('2028-02-29T10:00:00+02:00'))).toBe(58 * 24 + 10)
    expect(referenceHourIndex(at('2028-03-01T10:00:00+02:00'))).toBe(59 * 24 + 10)
  })
  it('accumulates lost kWh into 8760 hours', () => {
    const steps = lostSteps({ startMs: at('2026-03-10T11:00:00+02:00'), endMs: at('2026-03-10T13:00:00+02:00') }, [], b, full)
    const h = lostHourlyKwh(steps)
    expect(h).toHaveLength(8760)
    expect(h[referenceHourIndex(at('2026-03-10T11:00:00+02:00'))]).toBeCloseTo(10, 6)
    expect(h[referenceHourIndex(at('2026-03-10T12:00:00+02:00'))]).toBeCloseTo(10, 6)
    expect(h.reduce((s, v) => s + v, 0)).toBeCloseTo(20, 6)
  })
})
