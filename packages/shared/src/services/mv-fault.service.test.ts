import { describe, it, expect } from 'vitest'
import { solveZbus, faultsForNetwork } from './mv-fault.service'
import { cabs } from './mv-complex'
import type { MvNetwork } from './mv-protection.types'

const base = { sBaseVA: 100e6, cMax: 1.1, cMin: 1.0 }

describe('radial regression — reproduces 15.06 kA', () => {
  const net: MvNetwork = {
    ...base,
    buses: [
      { id: 'A', name: 'A', baseKv: 11 },
      { id: 'BUS', name: 'BUS', baseKv: 11 },
    ],
    branches: [
      { id: 'l1', kind: 'line', from: 'A', to: 'BUS', closed: true, rPerKm: 0.1, xPerKm: 0.1, lengthKm: 1 },
    ],
    infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10 }],
  }
  it('BUS Ik3 max ≈ 15.06 kA, min ≈ 13.69, X/R ≈ 3.30', () => {
    const b = faultsForNetwork(net).BUS
    if (b.islanded) throw new Error('unexpected islanded')
    expect(b.ik3MaxKa).toBeCloseTo(15.06, 1)
    expect(b.ik3MinKa).toBeCloseTo(13.69, 1)
    expect(b.xrRatio).toBeCloseTo(3.3, 1)
  })
  it('grid bus A ≈ 20.2 kA (stub does not load the source)', () => {
    const b = faultsForNetwork(net).A
    if (b.islanded) throw new Error('islanded')
    expect(b.ik3MaxKa).toBeCloseTo(20.2, 1)
  })
})

describe('parallel paths halve the branch impedance', () => {
  const mk = (n: number): MvNetwork => ({
    ...base,
    cMax: 1.0,
    buses: [
      { id: 'A', name: 'A', baseKv: 11 },
      { id: 'F', name: 'F', baseKv: 11 },
    ],
    branches: Array.from({ length: n }, (_, i) => ({
      id: `l${i}`, kind: 'line' as const, from: 'A', to: 'F', closed: true, rPerKm: 0, xPerKm: 0.121, lengthKm: 1,
    })),
    infeeds: [{ id: 'g', bus: 'A', sscVA: 1e12, xr: 1e6 }],
  })
  it('two parallel lines ≈ double the single-line fault current', () => {
    const f1 = faultsForNetwork(mk(1)).F
    const f2 = faultsForNetwork(mk(2)).F
    if (f1.islanded || f2.islanded) throw new Error('islanded')
    expect(f2.ik3MaxKa / f1.ik3MaxKa).toBeCloseTo(2, 1)
  })
})

describe('3-bus ring — closed vs open, via Z_kk', () => {
  const ring = (acClosed: boolean): MvNetwork => ({
    ...base,
    cMax: 1.0,
    buses: ['A', 'B', 'C'].map((id) => ({ id, name: id, baseKv: 11 })),
    branches: [
      { id: 'AB', kind: 'line', from: 'A', to: 'B', closed: true, rPerKm: 0, xPerKm: 0.121, lengthKm: 1 },
      { id: 'BC', kind: 'line', from: 'B', to: 'C', closed: true, rPerKm: 0, xPerKm: 0.121, lengthKm: 1 },
      { id: 'CA', kind: 'line', from: 'C', to: 'A', closed: acClosed, rPerKm: 0, xPerKm: 0.121, lengthKm: 1 },
    ],
    infeeds: [{ id: 'g', bus: 'A', sscVA: 2000e6, xr: 1e6 }],
  })
  it('Z_BB ≈ j0.1167 closed, ≈ j0.15 open; closed Ik > open Ik', () => {
    const zc = solveZbus(ring(true))
    const zo = solveZbus(ring(false))
    const ib = zc.index.get('B')!
    expect(cabs(zc.Z[ib][ib])).toBeCloseTo(0.1167, 3)
    expect(cabs(zo.Z[zo.index.get('B')!][zo.index.get('B')!])).toBeCloseTo(0.15, 3)
    const fc = faultsForNetwork(ring(true)).B
    const fo = faultsForNetwork(ring(false)).B
    if (fc.islanded || fo.islanded) throw new Error('islanded')
    expect(fc.ik3MaxKa).toBeGreaterThan(fo.ik3MaxKa)
  })
})

describe('cross-voltage LV fault', () => {
  const net: MvNetwork = {
    ...base,
    buses: [
      { id: 'MV', name: 'MV', baseKv: 11 },
      { id: 'LV', name: 'LV', baseKv: 0.4 },
    ],
    branches: [
      { id: 't1', kind: 'transformer', from: 'MV', to: 'LV', closed: true, ukrPct: 6, sRatedVA: 1e6 },
    ],
    infeeds: [{ id: 'g', bus: 'MV', sscVA: 100000e6, xr: 10 }],
  }
  it('LV Ik3 ≈ 26.5 kA (1 MVA, uk 6%, c=1.1)', () => {
    const b = faultsForNetwork(net).LV
    if (b.islanded) throw new Error('islanded')
    expect(b.ik3MaxKa).toBeCloseTo(26.5, 0)
  })
})

describe('islanding', () => {
  it('a bus with no closed path to an infeed is islanded', () => {
    const net: MvNetwork = {
      ...base,
      buses: [
        { id: 'A', name: 'A', baseKv: 11 },
        { id: 'X', name: 'X', baseKv: 11 },
      ],
      branches: [
        { id: 'l', kind: 'line', from: 'A', to: 'X', closed: false, rPerKm: 0.1, xPerKm: 0.1, lengthKm: 1 },
      ],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10 }],
    }
    expect(faultsForNetwork(net).X.islanded).toBe(true)
    expect(faultsForNetwork(net).A.islanded).toBe(false)
  })
})
