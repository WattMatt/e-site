/**
 * mv-network.service.ts — adapter: e-site unified graph → engine `MvNetwork` (pure TS).
 *
 * The ONLY module that knows both shapes. Maps `structure.nodes` (vertices) +
 * `cable_schedule.{sources,supplies,cables}` (edges) + the new `fault_sources`
 * facets (source/transformer/generator/inverter impedances) onto the per-unit
 * `MvNetwork` the Z-bus engine (`mv-fault.service`) consumes. No DB access.
 *
 * v1 mapping decisions (documented; refine in later phases):
 *  - Buses = nodes; baseKv = `voltage_v / 1000` (fallback 0.4 kV).
 *  - A node→node supply is a LINE; its cables are parallel-combined into one
 *    equivalent series impedance (handles mixed sizes), expressed as a 1 km
 *    branch carrying the total Ω so the engine's zBase conversion still applies.
 *  - A supply into a `mini_sub` node that has a transformer fault-source is a
 *    TRANSFORMER branch (its Z from `uk_pct`). The HV feeder cable on that edge
 *    is NEGLECTED in v1 (small vs the transformer Z).
 *  - A source→node supply attaches a shunt at the to-node: UTILITY/COUNCIL_RMU →
 *    grid Infeed (S″k); PV → Inverter (current-limited); STANDBY → generator
 *    MachineInfeed. The short source-connection cable is neglected in v1.
 *  - A `generator` node with a generator fault-source → MachineInfeed shunt.
 *  - Transformer neutral earthing comes from the transformer fault-source.
 *  - All branches `closed` (ring open-points are a later phase).
 */
import { cx, cadd, cinv, type Cx } from './mv-complex'
import type {
  MvNetwork,
  Bus,
  Branch,
  Infeed,
  MachineInfeed,
  Inverter,
  EarthingTransformer,
  NeutralEarthing,
} from './mv-protection.types'

// --- e-site row shapes consumed (minimal subsets of the real columns) ---
export interface GraphNode {
  id: string
  code: string
  kind: string // 'mini_sub' | 'generator' | 'rmu' | 'main_board' | …
  voltage_v: number | null
  breaker_rating_a: number | null
}
export interface GraphSource {
  id: string
  type: string // 'UTILITY' | 'COUNCIL_RMU' | 'PV' | 'STANDBY'
}
export interface GraphSupply {
  id: string
  from_source_id: string | null
  from_node_id: string | null
  to_node_id: string
}
export interface GraphCable {
  id: string
  supply_id: string
  ohm_per_km: number | null
  x_per_km: number | null
  measured_length_m: number | null
  confirmed_length_m: number | null
}
/** Earthing facet shared by transformer windings / sources. */
export interface FaultEarthing {
  kind: NeutralEarthing['kind']
  ohm?: number | null
}
/** cable_schedule.fault_sources — keyed by node_id XOR source_id. */
export interface FaultSource {
  node_id: string | null
  source_id: string | null
  role: 'utility' | 'transformer' | 'generator' | 'inverter'
  // utility
  ssc_mva?: number | null
  xr_ratio?: number | null
  z0_over_z1?: number | null
  // transformer
  uk_pct?: number | null
  pkr_w?: number | null
  s_rated_va?: number | null
  vector_group?: string | null
  lv_earthing?: FaultEarthing | null
  // generator
  xd_pct?: number | null
  // inverter
  current_limit_factor?: number | null
}
export interface MvStudySettings {
  base_mva: number
  c_max: number
  c_min: number
  ef_fault_resistance_ohm?: number | null
}
export interface MvNetworkInput {
  nodes: GraphNode[]
  sources: GraphSource[]
  supplies: GraphSupply[]
  cables: GraphCable[]
  faultSources: FaultSource[]
  settings: MvStudySettings
  lengthMode?: 'design' | 'as-built'
}

const DEFAULT_KV = 0.4
const baseKvOf = (n: GraphNode) => (n.voltage_v != null && n.voltage_v > 0 ? n.voltage_v / 1000 : DEFAULT_KV)
const earthingOf = (e: FaultEarthing | null | undefined): NeutralEarthing | undefined =>
  e == null ? undefined : { kind: e.kind, ohms: e.ohm ?? undefined }

function lengthM(c: GraphCable, mode: 'design' | 'as-built'): number {
  const m = mode === 'as-built' ? (c.confirmed_length_m ?? c.measured_length_m) : (c.measured_length_m ?? c.confirmed_length_m)
  return m ?? 0
}

/** Parallel-combine a supply's cables → total complex Ω (Z = 1/Σ(1/Zi)). */
function combinedCableOhms(cables: GraphCable[], mode: 'design' | 'as-built'): Cx {
  let ySum: Cx = cx(0)
  let any = false
  for (const c of cables) {
    const zi = cx((c.ohm_per_km ?? 0) * (lengthM(c, mode) / 1000), (c.x_per_km ?? 0) * (lengthM(c, mode) / 1000))
    if (zi.re === 0 && zi.im === 0) continue
    ySum = cadd(ySum, cinv(zi))
    any = true
  }
  return any ? cinv(ySum) : cx(0)
}

export function buildMvNetwork(input: MvNetworkInput): MvNetwork {
  const mode = input.lengthMode ?? 'design'
  const nodeById = new Map(input.nodes.map((n) => [n.id, n]))
  const sourceById = new Map(input.sources.map((s) => [s.id, s]))
  const cablesBySupply = new Map<string, GraphCable[]>()
  for (const c of input.cables) {
    const arr = cablesBySupply.get(c.supply_id)
    if (arr) arr.push(c)
    else cablesBySupply.set(c.supply_id, [c])
  }
  const fsByNode = new Map(input.faultSources.filter((f) => f.node_id).map((f) => [f.node_id!, f]))
  const fsBySource = new Map(input.faultSources.filter((f) => f.source_id).map((f) => [f.source_id!, f]))

  const buses: Bus[] = input.nodes.map((n) => ({
    id: n.id,
    name: n.code,
    baseKv: baseKvOf(n),
    breakingCapacityKa: n.breaker_rating_a != null ? n.breaker_rating_a / 1000 : undefined,
  }))

  const branches: Branch[] = []
  const infeeds: Infeed[] = []
  const machines: MachineInfeed[] = []
  const inverters: Inverter[] = []
  const earthingTransformers: EarthingTransformer[] = []

  for (const sup of input.supplies) {
    if (sup.from_source_id) {
      // source-origin → a shunt source at the to-node
      const src = sourceById.get(sup.from_source_id)
      const fs = fsBySource.get(sup.from_source_id)
      if (!src) continue
      if (src.type === 'UTILITY' || src.type === 'COUNCIL_RMU') {
        infeeds.push({
          id: sup.id,
          bus: sup.to_node_id,
          sscVA: (fs?.ssc_mva ?? 0) * 1e6,
          xr: fs?.xr_ratio ?? 10,
          z0OverZ1: fs?.z0_over_z1 ?? undefined,
        })
      } else if (src.type === 'PV') {
        inverters.push({ id: sup.id, bus: sup.to_node_id, sRatedVA: fs?.s_rated_va ?? 0, currentLimitFactor: fs?.current_limit_factor ?? undefined })
      } else if (src.type === 'STANDBY') {
        machines.push({ id: sup.id, bus: sup.to_node_id, kind: 'generator', sRatedVA: fs?.s_rated_va ?? 0, xr: fs?.xr_ratio ?? 12, subTransientXdPct: fs?.xd_pct ?? undefined })
      }
      continue
    }
    if (!sup.from_node_id) continue
    const toNode = nodeById.get(sup.to_node_id)
    const txFs = fsByNode.get(sup.to_node_id)
    if (toNode?.kind === 'mini_sub' && txFs?.role === 'transformer') {
      // transformer branch (HV feeder cable neglected in v1)
      branches.push({
        id: sup.id,
        kind: 'transformer',
        from: sup.from_node_id,
        to: sup.to_node_id,
        closed: true,
        ukrPct: txFs.uk_pct ?? 6,
        sRatedVA: txFs.s_rated_va ?? 0,
        pkrW: txFs.pkr_w ?? undefined,
        vectorGroup: txFs.vector_group ?? undefined,
        z0OverZ1: txFs.z0_over_z1 ?? undefined,
        neutralEarthing: earthingOf(txFs.lv_earthing),
      })
    } else {
      // line branch — total Ω as a 1 km equivalent (parallel cables combined)
      const z = combinedCableOhms(cablesBySupply.get(sup.id) ?? [], mode)
      branches.push({ id: sup.id, kind: 'line', from: sup.from_node_id, to: sup.to_node_id, closed: true, rPerKm: z.re, xPerKm: z.im, lengthKm: 1, parallel: 1 })
    }
  }

  // generator NODES → machine shunts
  for (const n of input.nodes) {
    if (n.kind !== 'generator') continue
    const fs = fsByNode.get(n.id)
    if (fs?.role !== 'generator') continue
    machines.push({ id: `gen-${n.id}`, bus: n.id, kind: 'generator', sRatedVA: fs.s_rated_va ?? 0, xr: fs.xr_ratio ?? 12, subTransientXdPct: fs.xd_pct ?? undefined })
  }

  return {
    sBaseVA: input.settings.base_mva * 1e6,
    cMax: input.settings.c_max,
    cMin: input.settings.c_min,
    efFaultResistanceOhm: input.settings.ef_fault_resistance_ohm ?? undefined,
    buses,
    branches,
    infeeds,
    machines: machines.length ? machines : undefined,
    inverters: inverters.length ? inverters : undefined,
    earthingTransformers: earthingTransformers.length ? earthingTransformers : undefined,
  }
}
