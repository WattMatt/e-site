import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { HOURS_PER_YEAR } from './calendar'
import { fillWithScaledSynthesis, meterReferenceSeries } from './tenant-series'

function constantReadings(from: string, to: string, kw: number, skip: (d: string) => boolean = () => false): Reading[] {
  const out: Reading[] = []
  const [fy, fm, fd] = from.split('-').map(Number)
  const [ty, tm, td] = to.split('-').map(Number)
  for (let t = Date.UTC(fy, fm - 1, fd); t <= Date.UTC(ty, tm - 1, td); t += 86_400_000) {
    const d = new Date(t).toISOString().slice(0, 10)
    if (skip(d)) continue
    for (let k = 1; k <= 48; k++) out.push({ tsEnd: t - 7_200_000 + k * 1_800_000, value: kw, quality: QUALITY.OK })
  }
  return out
}

describe('fillWithScaledSynthesis', () => {
  it('scales synthesis to the meter\'s observed level, never fills with zero', () => {
    const aligned = new Float64Array(10).fill(NaN)
    const synth = new Float64Array(10).fill(3)
    for (let i = 0; i < 5; i++) aligned[i] = 6
    const r = fillWithScaledSynthesis(aligned, synth)
    expect(r).toMatchObject({ filledHours: 5, scale: 2 })
    expect([...r.series]).toEqual(Array(10).fill(6))
  })
})

describe('meterReferenceSeries', () => {
  it('a year with a 20-day hole: hole not filled (> 14 d), but every June target day still maps', () => {
    const readings = constantReadings('2025-01-01', '2025-12-31', 10, (d) => d >= '2025-06-01' && d <= '2025-06-20')
    const r = meterReferenceSeries({ readings, intervalMin: 30, referenceYear: 2027, fallbackSynth: new Float64Array(HOURS_PER_YEAR).fill(1) })
    expect(r.window).toEqual({ start: '2025-01-01', end: '2025-12-31' })
    expect(r.gapFill.unfilledHours).toBe(480)
    expect(r.missingMonths).toEqual([])
    expect(r.filledFromSynthesis).toBe(0)
    expect(r.series.every((v) => v === 10)).toBe(true)
  })
  it('six months of data: the other six are synthesis scaled to the meter (10 / 1)', () => {
    const readings = constantReadings('2025-01-01', '2025-06-30', 10)
    const r = meterReferenceSeries({ readings, intervalMin: 30, referenceYear: 2027, fallbackSynth: new Float64Array(HOURS_PER_YEAR).fill(1) })
    expect(r.missingMonths).toEqual([7, 8, 9, 10, 11, 12])
    expect(r.filledFromSynthesis).toBe(184 * 24)
    expect(r.synthesisScale).toBe(10)
    expect(r.series.every((v) => v === 10)).toBe(true)
  })
})
