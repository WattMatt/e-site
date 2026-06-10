import { describe, it, expect } from 'vitest'
import { classifyVectorGroup, earthFaultForNetwork } from './mv-zeroseq.service'
import type { MvNetwork, NeutralEarthing } from './mv-protection.types'

const base = { sBaseVA: 100e6, cMax: 1.1, cMin: 1.0 }

describe('classifyVectorGroup', () => {
  it('delta-paired earthed star → low-Z shunt on the earthed side', () => {
    expect(classifyVectorGroup('Dyn11')).toEqual({ kind: 'shunt', shuntSide: 'to' })
    expect(classifyVectorGroup('YNd1')).toEqual({ kind: 'shunt', shuntSide: 'from' })
    expect(classifyVectorGroup('Dzn0')).toEqual({ kind: 'shunt', shuntSide: 'to' })
  })
  it('both windings earthed → series', () => {
    expect(classifyVectorGroup('YNyn0').kind).toBe('series')
    expect(classifyVectorGroup('ZNyn0').kind).toBe('series')
  })
  it('no earthed winding → open', () => {
    expect(classifyVectorGroup('Dd0').kind).toBe('open')
    expect(classifyVectorGroup('Yy0').kind).toBe('open')
    expect(classifyVectorGroup('Dy11').kind).toBe('open')
  })
  it('earthed star with NO delta return → open, not a Z0=Z1 shunt', () => {
    expect(classifyVectorGroup('YNy0').kind).toBe('open')
    expect(classifyVectorGroup('Yyn0').kind).toBe('open')
  })
})

const dynLv = (earth?: NeutralEarthing): MvNetwork => ({
  ...base,
  buses: [
    { id: 'MV', name: 'MV', baseKv: 11 },
    { id: 'LV', name: 'LV', baseKv: 0.4 },
  ],
  branches: [
    { id: 't', kind: 'transformer', from: 'MV', to: 'LV', closed: true, ukrPct: 6, sRatedVA: 1e6, vectorGroup: 'Dyn', neutralEarthing: earth },
  ],
  infeeds: [{ id: 'g', bus: 'MV', sscVA: 100000e6, xr: 10, z0OverZ1: 1 }],
})

describe('earthFaultForNetwork', () => {
  it('solid-earthed Dyn LV fault: Ik1 ≈ Ik3 ≈ 26.5 kA', () => {
    const ef = earthFaultForNetwork(dynLv({ kind: 'solid' })).LV
    if ('noEarthPath' in ef) throw new Error('unexpected no path')
    expect(ef.ik1Ka).toBeCloseTo(26.5, 0)
  })
  it('500 A NER clamps Ik1 to ≈ 0.55 kA', () => {
    const ef = earthFaultForNetwork(dynLv({ kind: 'resistance', ohms: 0.4619 })).LV
    if ('noEarthPath' in ef) throw new Error('unexpected no path')
    expect(ef.ik1Ka).toBeCloseTo(0.55, 1)
  })
  it('YNd delta-side bus has no earth path', () => {
    const net: MvNetwork = {
      ...base,
      buses: [
        { id: 'A', name: 'A', baseKv: 11 },
        { id: 'B', name: 'B', baseKv: 11 },
      ],
      branches: [
        { id: 't', kind: 'transformer', from: 'A', to: 'B', closed: true, ukrPct: 6, sRatedVA: 5e6, vectorGroup: 'YNd', neutralEarthing: { kind: 'solid' } },
      ],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10, z0OverZ1: 1 }],
    }
    const ef = earthFaultForNetwork(net).B
    expect('noEarthPath' in ef && ef.noEarthPath).toBe(true)
    expect('noEarthPath' in earthFaultForNetwork(net).A).toBe(false)
  })
  it('a zig-zag earthing transformer restores Ik1 on that bus', () => {
    const net: MvNetwork = {
      ...base,
      buses: [
        { id: 'A', name: 'A', baseKv: 11 },
        { id: 'B', name: 'B', baseKv: 11 },
      ],
      branches: [
        { id: 't', kind: 'transformer', from: 'A', to: 'B', closed: true, ukrPct: 6, sRatedVA: 5e6, vectorGroup: 'YNd', neutralEarthing: { kind: 'solid' } },
      ],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10, z0OverZ1: 1 }],
      earthingTransformers: [{ id: 'zz', bus: 'B', z0Ohm: 5, earthing: { kind: 'solid' } }],
    }
    const ef = earthFaultForNetwork(net).B
    if ('noEarthPath' in ef) throw new Error('still no path')
    expect(ef.ik1Ka).toBeGreaterThan(0)
  })
})

describe('minimum earth fault (EF sensitivity)', () => {
  const mvEf = (rfOhm = 0): MvNetwork => ({
    ...base,
    buses: [{ id: 'A', name: 'A', baseKv: 11 }],
    branches: [],
    infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10, z0OverZ1: 1 }],
    efFaultResistanceOhm: rfOhm,
  })
  it('reports a min Ik1 below the bolted max (c_min < c_max)', () => {
    const ef = earthFaultForNetwork(mvEf()).A
    if ('noEarthPath' in ef) throw new Error('no path')
    expect(ef.ik1MinKa).toBeLessThan(ef.ik1Ka)
    expect(ef.ik1MinKa).toBeCloseTo(ef.ik1Ka * (1.0 / 1.1), 2) // same Z, only c differs
  })
  it('an assumed fault resistance collapses the min Ik1 but not the max', () => {
    const noR = earthFaultForNetwork(mvEf(0)).A
    const withR = earthFaultForNetwork(mvEf(20)).A
    if ('noEarthPath' in noR || 'noEarthPath' in withR) throw new Error('no path')
    expect(withR.ik1MinKa).toBeLessThan(noR.ik1MinKa * 0.1) // 20 Ω dominates the 11 kV loop
    expect(withR.ik1Ka).toBeCloseTo(noR.ik1Ka, 6) // the bolted max ignores R_F
  })
})

describe('unearthed network capacitive earth fault', () => {
  const unearthed = (withC0: boolean): MvNetwork => ({
    ...base,
    buses: [
      { id: 'A', name: 'A', baseKv: 11 },
      { id: 'B', name: 'B', baseKv: 11 },
      { id: 'C', name: 'C', baseKv: 11 },
    ],
    branches: [
      { id: 't', kind: 'transformer', from: 'A', to: 'B', closed: true, ukrPct: 6, sRatedVA: 5e6, vectorGroup: 'YNd', neutralEarthing: { kind: 'solid' } },
      { id: 'cab', kind: 'line', from: 'B', to: 'C', closed: true, rPerKm: 0.1, xPerKm: 0.1, lengthKm: 5, c0nFPerKm: withC0 ? 250 : undefined },
    ],
    infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10, z0OverZ1: 1 }],
  })
  it('reports the capacitive Ic on the delta-side (unearthed) bus', () => {
    const ef = earthFaultForNetwork(unearthed(true)).B
    if (!('noEarthPath' in ef)) throw new Error('expected unearthed bus')
    expect(ef.noEarthPath).toBe(true)
    expect(ef.icAmps).toBeCloseTo(7.48, 0) // √3·ω·(250 nF × 5 km)·11 kV
  })
  it('leaves Ic undefined when no line carries C0 data', () => {
    const ef = earthFaultForNetwork(unearthed(false)).B
    expect('noEarthPath' in ef && ef.icAmps).toBeUndefined()
  })
})
