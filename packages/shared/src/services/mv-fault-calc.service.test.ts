import { describe, it, expect } from 'vitest'
import {
  magnitude,
  seriesSum,
  splitByXR,
  sourceImpedance,
  transformerImpedance,
  feederImpedance,
  kappa,
  faultAtNode,
  faultResultsForStudy,
} from './mv-fault-calc.service'

describe('impedance primitives', () => {
  it('splitByXR preserves magnitude and ratio', () => {
    const z = splitByXR(0.345714, 10)
    expect(magnitude(z)).toBeCloseTo(0.345714, 6)
    expect(z.x / z.r).toBeCloseTo(10, 6)
  })
  it('seriesSum adds component-wise', () => {
    const s = seriesSum([{ r: 0.034, x: 0.344 }, { r: 0.1, x: 0.1 }])
    expect(s.r).toBeCloseTo(0.134, 9)
    expect(s.x).toBeCloseTo(0.444, 9)
  })
  it('source impedance from short-circuit MVA (|Z| = Un^2 / Ssc)', () => {
    const z = sourceImpedance({ unV: 11000, sscVA: 350e6, xr: 10 })
    expect(magnitude(z)).toBeCloseTo(0.345714, 5)
    expect(z.r).toBeCloseTo(0.0344, 4)
    expect(z.x).toBeCloseTo(0.344, 3)
  })
  it('transformer impedance from uk% and load loss', () => {
    // 1 MVA, 11 kV, uk=6%, Pk=10 kW
    const z = transformerImpedance({ unV: 11000, sRatedVA: 1e6, ukrPct: 6, pkrW: 10000 })
    expect(magnitude(z)).toBeCloseTo(7.26, 2)
    expect(z.r).toBeCloseTo(1.21, 2)
    expect(z.x).toBeCloseTo(7.1585, 3)
  })
  it('feeder impedance scales with length and parallel count', () => {
    expect(feederImpedance({ rPerKm: 0.1, xPerKm: 0.1, lengthKm: 1 })).toEqual({ r: 0.1, x: 0.1 })
    expect(feederImpedance({ rPerKm: 0.2, xPerKm: 0.1, lengthKm: 2, parallel: 2 })).toEqual({ r: 0.2, x: 0.1 })
  })
})

describe('kappa (peak factor)', () => {
  it('approaches 2.0 as X/R grows', () => {
    expect(kappa(1000)).toBeCloseTo(2.0, 2)
  })
  it('known value at X/R = 3.30357', () => {
    expect(kappa(3.30357)).toBeCloseTo(1.4153, 3)
  })
})

describe('faultAtNode (seed busbar: source + 1 km feeder at 11 kV)', () => {
  const zk = seriesSum([
    sourceImpedance({ unV: 11000, sscVA: 350e6, xr: 10 }),
    feederImpedance({ rPerKm: 0.1, xPerKm: 0.1, lengthKm: 1 }),
  ])
  it('Ik3 max at c=1.1 is ~15.06 kA, X/R ~3.30, ip ~30.14 kA', () => {
    const r = faultAtNode({ zk, unV: 11000, c: 1.1 })
    expect(r.ik3A / 1000).toBeCloseTo(15.06, 1)
    expect(r.xr).toBeCloseTo(3.3, 1)
    expect(r.ipA / 1000).toBeCloseTo(30.14, 0)
  })
  it('Ik3 min at c=1.0 is ~13.69 kA', () => {
    const r = faultAtNode({ zk, unV: 11000, c: 1.0 })
    expect(r.ik3A / 1000).toBeCloseTo(13.69, 1)
  })
})

describe('faultResultsForStudy (radial walk source→feeder→node)', () => {
  it('returns busbar fault row with sandbox basis', () => {
    const res = faultResultsForStudy({
      source: { unV: 11000, sscVA: 350e6, xr: 10 },
      cMax: 1.1,
      cMin: 1.0,
      nodes: [{ id: 'BUS', parentId: null, feeder: { rPerKm: 0.1, xPerKm: 0.1, lengthKm: 1 } }],
    })
    expect(res.BUS.ik3MaxKa).toBeCloseTo(15.06, 1)
    expect(res.BUS.ik3MinKa).toBeCloseTo(13.69, 1)
    expect(res.BUS.xrRatio).toBeCloseTo(3.3, 1)
    expect(res.BUS.basis).toContain('sandbox')
  })
})
