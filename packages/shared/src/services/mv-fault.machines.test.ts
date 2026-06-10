import { describe, it, expect } from 'vitest'
import { faultsForNetwork } from './mv-fault.service'
import type { MvNetwork } from './mv-protection.types'

const base = { sBaseVA: 100e6, cMax: 1.1, cMin: 1.0 }
const bus = (id: string) => ({ id, name: id, baseKv: 11 })

describe('machine fault infeed (generators + motors)', () => {
  it('a generator raises Ik3 at its bus', () => {
    const net = (withGen: boolean): MvNetwork => ({
      ...base,
      buses: [bus('A')],
      branches: [],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 350e6, xr: 10 }],
      machines: withGen ? [{ id: 'm', bus: 'A', kind: 'generator', sRatedVA: 5e6, xr: 10, subTransientXdPct: 15 }] : [],
    })
    const w = faultsForNetwork(net(true)).A
    const wo = faultsForNetwork(net(false)).A
    if (w.islanded || wo.islanded) throw new Error('islanded')
    expect(w.ik3MaxKa).toBeGreaterThan(wo.ik3MaxKa)
  })

  it('a generator alone (no grid) feeds the fault ≈ 1.92 kA', () => {
    const net: MvNetwork = {
      ...base,
      buses: [bus('A')],
      branches: [],
      infeeds: [],
      machines: [{ id: 'm', bus: 'A', kind: 'generator', sRatedVA: 5e6, xr: 10, subTransientXdPct: 15 }],
    }
    const f = faultsForNetwork(net).A
    if (f.islanded) throw new Error('generator should source the fault')
    expect(f.ik3MaxKa).toBeCloseTo(1.92, 1)
  })

  it('a motor boosts Ik3 max but is excluded from Ik3 min', () => {
    const withMotor: MvNetwork = {
      ...base,
      buses: [bus('A')],
      branches: [],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 200e6, xr: 10 }],
      machines: [{ id: 'm', bus: 'A', kind: 'motor', sRatedVA: 2e6, xr: 8, lockedRotorRatio: 6 }],
    }
    const noMotor: MvNetwork = { ...withMotor, machines: [] }
    const f = faultsForNetwork(withMotor).A
    const fn = faultsForNetwork(noMotor).A
    if (f.islanded || fn.islanded) throw new Error('islanded')
    expect(f.ik3MaxKa).toBeGreaterThan(fn.ik3MaxKa) // motor lifts the max fault
    expect(f.ik3MinKa).toBeCloseTo(fn.ik3MinKa, 3) // motor off in the min case
  })
})
