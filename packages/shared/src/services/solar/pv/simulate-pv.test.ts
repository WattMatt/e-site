import { describe, expect, it } from 'vitest'
import { loadWeather } from '../__fixtures__/pvgis'
import { recentre, simulatePv, sunPath, type PvArray, type PvSystem } from './simulate-pv'
import { monthlySums } from '../time'

const weather = loadWeather('jhb')
const sun = sunPath(weather)

const array = (over: Partial<PvArray> = {}): PvArray => ({
  id: 'a',
  kWpDc: 100,
  tiltDeg: 30,
  azimuthDeg: 0,
  module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
  cellTemp: { kind: 'noct', noctC: 45 },
  losses: { soiling: 0.02, shading: 0.01, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 },
  inverterId: 'inv',
  ...over,
})
const system = (over: Partial<PvSystem> = {}): PvSystem => ({
  arrays: [array()],
  inverters: [{ id: 'inv', acRatedKw: 1000 }],
  acLosses: { acWiring: 0.01, availability: 0.99 },
  albedo: 0.2,
  transposition: 'perez',
  ...over,
})

describe('recentre', () => {
  it('preserves the total exactly and moves a spike by (0.5 − offset) of an hour', () => {
    const s = new Float64Array(8760)
    s[100] = 10
    const r = recentre(s, 0.05)
    expect(r.reduce((a, b) => a + b, 0)).toBeCloseTo(10, 12)
    expect(r[99]).toBeCloseTo(4.5, 12) // hour 99's centre (99.5) is 0.55 h before the sample at 100.05
    expect(r[100]).toBeCloseTo(5.5, 12)
  })
})

describe('simulatePv on the Johannesburg TMY', () => {
  const r = simulatePv(weather, system(), sun)

  it('gives a plausible specific yield and PR for a north-facing 30° array', () => {
    expect(r.annual.specificYield).toBeGreaterThan(1700)
    expect(r.annual.specificYield).toBeLessThan(1900)
    expect(r.annual.performanceRatio).toBeGreaterThan(0.75)
    expect(r.annual.performanceRatio).toBeLessThan(0.85)
  })

  it('peaks at SAST solar noon (≈ 12:00–13:00), not two hours early', () => {
    const byHour = new Array(24).fill(0)
    for (let h = 0; h < 8760; h++) byHour[h % 24] += r.pAc[h]!
    const peak = byHour.indexOf(Math.max(...byHour))
    expect([11, 12]).toContain(peak)
  })

  it('is linear in kWp when nothing clips', () => {
    const r2 = simulatePv(weather, system({ arrays: [array({ kWpDc: 200 })] }), sun)
    expect(r2.annual.acKwh).toBeCloseTo(2 * r.annual.acKwh, 6)
  })

  it('clips at the inverter AC rating and never exceeds it after AC losses', () => {
    const c = simulatePv(weather, system({ inverters: [{ id: 'inv', acRatedKw: 50 }] }), sun)
    expect(c.annual.clippedKwh).toBeGreaterThan(0)
    expect(Math.max(...c.pAc)).toBeLessThanOrEqual(50 * 0.99 * 0.99 + 1e-9)
    expect(c.annual.acKwh).toBeLessThan(r.annual.acKwh)
  })

  it('winter (June) yields less than summer for a flat-ish array but more for a steep north array', () => {
    const flat = monthlySums(simulatePv(weather, system({ arrays: [array({ tiltDeg: 5 })] }), sun).pAc)
    const steep = monthlySums(simulatePv(weather, system({ arrays: [array({ tiltDeg: 60 })] }), sun).pAc)
    expect(flat[5]!).toBeLessThan(flat[11]!)
    expect(steep[5]!).toBeGreaterThan(steep[11]!)
  })

  it('Hay–Davies is a working fallback within 3 % of Perez', () => {
    const h = simulatePv(weather, system({ transposition: 'hay-davies' }), sun)
    expect(Math.abs(h.annual.acKwh / r.annual.acKwh - 1)).toBeLessThan(0.03)
  })

  it('Faiman is a working alternative to NOCT within 3 %', () => {
    const f = simulatePv(weather, system({ arrays: [array({ cellTemp: { kind: 'faiman', u0: 25, u1: 6.84 } })] }), sun)
    expect(Math.abs(f.annual.acKwh / r.annual.acKwh - 1)).toBeLessThan(0.03)
  })

  it('re-centres output on the hour midpoint: one sunny sample splits 0.45 / 0.55 across two hours', () => {
    const one = (v: number) => {
      const a = new Float64Array(8760)
      a[4332] = v // 30 Jun, 12:00–13:00 SAST
      return a
    }
    const w = { ...weather, sampleOffsetH: 0.05, ghi: one(600), dni: one(800), dhi: one(100), tAmb: new Float64Array(8760).fill(15) }
    const s = simulatePv(w, system(), sunPath(w))
    expect(s.pAc[4331]! / (s.pAc[4331]! + s.pAc[4332]!)).toBeCloseTo(0.45, 9)
    expect(s.pAc[4330]).toBe(0)
    expect(s.pAc[4333]).toBe(0)
  })

  it('refuses an array wired to an unknown inverter, an empty system and a bad albedo', () => {
    expect(() => simulatePv(weather, system({ arrays: [array({ inverterId: 'nope' })] }), sun)).toThrow(/unknown inverter nope/)
    expect(() => simulatePv(weather, system({ arrays: [] }), sun)).toThrow(/no arrays/)
    expect(() => simulatePv(weather, system({ albedo: 20 }), sun)).toThrow(/albedo/)
  })
})
