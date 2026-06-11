import { describe, it, expect } from 'vitest'
import { buildMvNetwork, type MvNetworkInput } from './mv-network.service'
import { faultsForNetwork } from './mv-fault.service'

const settings = { base_mva: 100, c_max: 1.1, c_min: 1.0 }

describe('buildMvNetwork — e-site graph → engine MvNetwork', () => {
  it('maps utility → RMU → transformer → LV and solves sensible fault levels', () => {
    const input: MvNetworkInput = {
      settings,
      nodes: [
        { id: 'rmu', code: 'RMU', kind: 'rmu', voltage_v: 11000, breaker_rating_a: null },
        { id: 'lv', code: 'LV', kind: 'mini_sub', voltage_v: 400, breaker_rating_a: null },
      ],
      sources: [{ id: 'u', type: 'UTILITY' }],
      supplies: [
        { id: 's1', from_source_id: 'u', from_node_id: null, to_node_id: 'rmu' },
        { id: 's2', from_source_id: null, from_node_id: 'rmu', to_node_id: 'lv' },
      ],
      cables: [],
      faultSources: [
        { node_id: null, source_id: 'u', role: 'utility', ssc_mva: 350, xr_ratio: 10, z0_over_z1: 1 },
        { node_id: 'lv', source_id: null, role: 'transformer', uk_pct: 6, s_rated_va: 1e6, vector_group: 'Dyn' },
      ],
    }
    const net = buildMvNetwork(input)
    // structure
    expect(net.buses.map((b) => b.id).sort()).toEqual(['lv', 'rmu'])
    expect(net.infeeds).toHaveLength(1)
    expect(net.infeeds[0]).toMatchObject({ bus: 'rmu', sscVA: 350e6, xr: 10 })
    expect(net.branches).toHaveLength(1)
    expect(net.branches[0]).toMatchObject({ kind: 'transformer', from: 'rmu', to: 'lv', ukrPct: 6, sRatedVA: 1e6 })
    // end-to-end through the engine
    const f = faultsForNetwork(net)
    const rmu = f.rmu, lv = f.lv
    if (rmu.islanded || lv.islanded) throw new Error('islanded')
    expect(rmu.ik3MaxKa).toBeCloseTo(20.2, 1) // 350 MVA infeed at 11 kV
    expect(lv.ik3MaxKa).toBeGreaterThan(24) // through a 1 MVA / 6% transformer
    expect(lv.ik3MaxKa).toBeLessThan(27)
  })

  it('parallel-combines a supply’s cables into one equivalent line impedance', () => {
    const base = (nCables: number): MvNetworkInput => ({
      settings,
      nodes: [
        { id: 'a', code: 'A', kind: 'rmu', voltage_v: 11000, breaker_rating_a: null },
        { id: 'b', code: 'B', kind: 'main_board', voltage_v: 11000, breaker_rating_a: null },
      ],
      sources: [{ id: 'u', type: 'UTILITY' }],
      supplies: [
        { id: 's1', from_source_id: 'u', from_node_id: null, to_node_id: 'a' },
        { id: 's2', from_source_id: null, from_node_id: 'a', to_node_id: 'b' },
      ],
      cables: Array.from({ length: nCables }, (_, i) => ({
        id: `c${i}`, supply_id: 's2', ohm_per_km: 0.1, x_per_km: 0.1, measured_length_m: 1000, confirmed_length_m: null,
      })),
      faultSources: [{ node_id: null, source_id: 'u', role: 'utility', ssc_mva: 350, xr_ratio: 10 }],
    })
    const lineR = (n: number) => {
      const br = buildMvNetwork(base(n)).branches.find((x) => x.kind === 'line')
      if (!br || br.kind !== 'line') throw new Error('no line branch')
      return br.rPerKm
    }
    expect(lineR(1)).toBeCloseTo(0.1, 4) // one cable: 0.1 Ω/km × 1 km
    expect(lineR(2)).toBeCloseTo(0.05, 4) // two in parallel: half
  })

  it('maps a generator node + fault-source to a machine infeed', () => {
    const input: MvNetworkInput = {
      settings,
      nodes: [{ id: 'g', code: 'GEN', kind: 'generator', voltage_v: 11000, breaker_rating_a: null }],
      sources: [],
      supplies: [],
      cables: [],
      faultSources: [{ node_id: 'g', source_id: null, role: 'generator', s_rated_va: 5e6, xd_pct: 15, xr_ratio: 12 }],
    }
    const net = buildMvNetwork(input)
    expect(net.machines).toHaveLength(1)
    expect(net.machines![0]).toMatchObject({ bus: 'g', kind: 'generator', sRatedVA: 5e6, subTransientXdPct: 15 })
  })
})
