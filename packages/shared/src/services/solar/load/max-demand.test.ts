import { describe, it, expect } from 'vitest'
import { QUALITY, type Reading } from '../../../meter-data/types'
import { designMaxDemandSynth, diversityApplies, DIVERSITY_DISABLED_REASON } from './diversity'
import { monthlyMaxDemand, monthlyMaxDemandFromHourly } from './max-demand'

const SPIKE_END = Date.UTC(2025, 2, 15, 10, 0)
function readings(scale = 1): Reading[] {
  const out: Reading[] = []
  for (let t = Date.UTC(2025, 1, 28, 22, 30); t <= Date.UTC(2025, 3, 30, 22, 0); t += 1_800_000) {
    out.push({ tsEnd: t, value: (t === SPIKE_END ? 200 : 100) * scale, quality: QUALITY.OK })
  }
  return out
}

describe('monthlyMaxDemand (engine spec §2.6)', () => {
  it('a measured kVA channel is used directly (B/C)', () => {
    const r = monthlyMaxDemand({ kw: readings(), kva: readings(1 / 0.9), intervalMin: 30 })
    if ('error' in r) throw new Error(r.error)
    expect(r.months.map((m) => [m.month, Math.round(m.kva * 1000) / 1000, m.source])).toEqual([
      ['2025-03', 222.222, 'measured_kva'], ['2025-04', 111.111, 'measured_kva'],
    ])
    expect(r.months[0].tsEnd).toBe(SPIKE_END)
  })
  it('kW only (most A files): kW / assumed PF 0.95', () => {
    const r = monthlyMaxDemand({ kw: readings(), intervalMin: 30 })
    if ('error' in r) throw new Error(r.error)
    expect(r.months[0]).toMatchObject({ month: '2025-03', source: 'kw_over_pf', powerFactor: 0.95 })
    expect(r.months[0].kva).toBeCloseTo(200 / 0.95, 9)
    expect(r.months[1].kva).toBeCloseTo(100 / 0.95, 9)
  })
  it('only chargeable intervals count (tariff TOU windows arrive in Phase 2)', () => {
    const r = monthlyMaxDemand({ kw: readings(), intervalMin: 30 }, { isChargeable: (t) => t !== SPIKE_END })
    if ('error' in r) throw new Error(r.error)
    expect(r.months[0].kva).toBeCloseTo(100 / 0.95, 9)
  })
  it('a month with kW but no kVA falls back to kW / PF for that month (it is not dropped)', () => {
    const kvaMarchOnly = readings(1 / 0.9).filter((r) => r.tsEnd < Date.UTC(2025, 2, 31, 22, 0))
    const r = monthlyMaxDemand({ kw: readings(), kva: kvaMarchOnly, intervalMin: 30 })
    if ('error' in r) throw new Error(r.error)
    expect(r.months.map((m) => [m.month, m.source, m.powerFactor])).toEqual([
      ['2025-03', 'measured_kva', null], ['2025-04', 'kw_over_pf', 0.95],
    ])
    expect(r.months[0].kva).toBeCloseTo(200 / 0.9, 9)
    expect(r.months[1].kva).toBeCloseTo(100 / 0.95, 9)
  })
  it('daily files cannot yield MD', () => {
    expect(monthlyMaxDemand({ kw: readings(), intervalMin: 1440 })).toEqual({ error: 'daily_interval' })
  })
  it('from an hourly site series (S2–S4)', () => {
    const s = new Float64Array(8760).fill(10)
    s[100] = 19
    const r = monthlyMaxDemandFromHourly(s, 2027)
    expect(r[0]).toMatchObject({ month: '2027-01', source: 'hourly_series' })
    expect(r[0].kva).toBeCloseTo(20, 9)
    expect(r[1].kva).toBeCloseTo(10 / 0.95, 9)
  })
  it('a month of the hourly series with no data has NO MD (null), not 0 kVA', () => {
    const s = new Float64Array(8760).fill(10)
    s.fill(Number.NaN, 31 * 24, 59 * 24) // February 2027 (28 days) all missing
    const r = monthlyMaxDemandFromHourly(s, 2027)
    expect(r[1]).toMatchObject({ month: '2027-02', kva: null })
    expect(r[2].kva).toBeCloseTo(10 / 0.95, 9)
  })
})

describe('diversity (engine spec §2.5)', () => {
  it('k × Σ tenant peaks, for synthesised tenants only', () => {
    const a = new Float64Array(8760).fill(1)
    const b = new Float64Array(8760).fill(2)
    a[5] = 10
    b[7] = 20
    expect(designMaxDemandSynth([a, b], 0.8)).toBeCloseTo(24, 12)
    expect(() => designMaxDemandSynth([a], 1.2)).toThrow(RangeError)
    expect([diversityApplies('S1'), diversityApplies('S2'), diversityApplies('S3'), diversityApplies('S4')]).toEqual([false, false, true, false])
    expect(DIVERSITY_DISABLED_REASON).toBe('Measured data already reflects diversity')
  })
})
