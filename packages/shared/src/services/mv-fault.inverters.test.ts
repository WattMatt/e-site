import { describe, it, expect } from 'vitest'
import { faultsForNetwork } from './mv-fault.service'
import type { MvNetwork } from './mv-protection.types'

const base = { sBaseVA: 100e6, cMax: 1.1, cMin: 1.0 }
const bus = (id: string) => ({ id, name: id, baseKv: 11 })
const iRatedKa = (sVA: number, kv: number) => sVA / (Math.sqrt(3) * kv * 1000) / 1000

describe('IBR / inverter fault contribution', () => {
  it('an inverter at the fault bus adds its current limit (1.2× rated), and is excluded from Ik3 min', () => {
    const net = (withInv: boolean): MvNetwork => ({
      ...base,
      buses: [bus('A')],
      branches: [],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 200e6, xr: 10 }],
      inverters: withInv ? [{ id: 'pv', bus: 'A', sRatedVA: 2e6, currentLimitFactor: 1.2 }] : [],
    })
    const w = faultsForNetwork(net(true)).A
    const wo = faultsForNetwork(net(false)).A
    if (w.islanded || wo.islanded) throw new Error('islanded')
    expect(w.ik3MaxKa - wo.ik3MaxKa).toBeCloseTo(1.2 * iRatedKa(2e6, 11), 2) // full at its own bus
    expect(w.ik3MinKa).toBeCloseTo(wo.ik3MinKa, 6) // IBR off in the min case
  })

  it('full at its own bus, less to a downstream fault (current divides into the source)', () => {
    const withInv: MvNetwork = {
      ...base,
      buses: [bus('A'), bus('B')],
      infeeds: [{ id: 'g', bus: 'A', sscVA: 200e6, xr: 10 }],
      branches: [{ id: 'l', kind: 'line', from: 'A', to: 'B', closed: true, rPerKm: 0.1, xPerKm: 0.1, lengthKm: 2 }],
      inverters: [{ id: 'pv', bus: 'A', sRatedVA: 2e6 }],
    }
    const noInv: MvNetwork = { ...withInv, inverters: [] }
    const fA = faultsForNetwork(withInv).A
    const fA0 = faultsForNetwork(noInv).A
    const fB = faultsForNetwork(withInv).B
    const fB0 = faultsForNetwork(noInv).B
    if (fA.islanded || fA0.islanded || fB.islanded || fB0.islanded) throw new Error('islanded')
    const contribA = fA.ik3MaxKa - fA0.ik3MaxKa // inverter at A, fault at A → full
    const contribB = fB.ik3MaxKa - fB0.ik3MaxKa // inverter at A, fault at B → diverted into the grid, less
    expect(contribA).toBeCloseTo(1.2 * iRatedKa(2e6, 11), 2) // full at its own bus
    expect(contribA).toBeGreaterThan(contribB)
    expect(contribB).toBeGreaterThan(0)
  })

  it('an inverter on a bus with no impedance-source path is ignored', () => {
    const net: MvNetwork = {
      ...base,
      buses: [bus('A'), bus('C')],
      branches: [], // C has no path to the infeed → islanded in the Z-bus
      infeeds: [{ id: 'g', bus: 'A', sscVA: 200e6, xr: 10 }],
      inverters: [{ id: 'pv', bus: 'C', sRatedVA: 5e6 }],
    }
    const a = faultsForNetwork(net).A
    const noInv = faultsForNetwork({ ...net, inverters: [] }).A
    if (a.islanded || noInv.islanded) throw new Error('islanded')
    expect(a.ik3MaxKa).toBeCloseTo(noInv.ik3MaxKa, 6) // islanded inverter can't reach the fault
  })
})
