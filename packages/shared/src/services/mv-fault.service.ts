/**
 * mv-fault.service.ts — per-unit Z-bus three-phase fault engine (pure TS).
 *
 * Build the complex bus admittance matrix Y on a common MVA base, invert to Z,
 * then the three-phase fault at bus k is c·I_base(k)/|Z_kk|. Open branches are
 * excluded; buses with no closed path to a source are islanded.
 *
 * Sources are shunts to reference: the grid infeed, plus rotating machines —
 * synchronous generators (x″d) and induction motors (locked-rotor). Machines
 * are included in the MAX fault (initial Ik″ + peak ip); motors are excluded
 * from the MIN fault (motors-off is the conservative protection-sensitivity case).
 * Inverter-based generation (PV/SSEG) is current-limited and NOT modelled here.
 * Sandbox convention: c applied once; K_T/K_G = 1; three-phase only.
 */
import { cx, cadd, csub, cinv, cabs, matInvert, type Cx } from './mv-complex'
import { kappa } from './mv-fault-calc.service'
import type { MvNetwork, Branch, MachineInfeed } from './mv-protection.types'

const SQRT3 = Math.sqrt(3)
const zBaseOhm = (baseKv: number, sBaseVA: number) => (baseKv * 1000) ** 2 / sBaseVA
const iBaseA = (baseKv: number, sBaseVA: number) => sBaseVA / (SQRT3 * baseKv * 1000)

/** Positive-sequence per-unit impedance of a transformer on the system base. */
export function transformerZ1pu(b: { ukrPct: number; sRatedVA: number; pkrW?: number }, sBaseVA: number): Cx {
  const z = (b.ukrPct / 100) * (sBaseVA / b.sRatedVA)
  const r = b.pkrW != null ? (b.pkrW / b.sRatedVA) * (sBaseVA / b.sRatedVA) : 0
  return cx(r, Math.sqrt(Math.max(z * z - r * r, 0)))
}

/** Positive-sequence per-unit impedance of a grid infeed. */
export function gridZ1pu(inf: { sscVA: number; xr: number }, sBaseVA: number): Cx {
  const mag = sBaseVA / inf.sscVA
  const r = mag / Math.hypot(1, inf.xr)
  return cx(r, r * inf.xr)
}

/**
 * Per-unit subtransient impedance of a rotating machine (synchronous generator
 * via x″d, or induction motor via locked-rotor ratio). Shunt to reference.
 */
export function machineZ1pu(m: MachineInfeed, sBaseVA: number): Cx {
  const reactancePct = m.kind === 'generator' ? (m.subTransientXdPct ?? 20) : 100 / (m.lockedRotorRatio ?? 6)
  const mag = (reactancePct / 100) * (sBaseVA / m.sRatedVA)
  const r = mag / Math.hypot(1, m.xr)
  return cx(r, r * m.xr)
}

/** Per-unit series impedance of a branch on the system base. */
function branchZpu(b: Branch, net: MvNetwork, baseKvOf: (id: string) => number): Cx {
  if (b.kind === 'line') {
    const n = b.parallel ?? 1
    const zb = zBaseOhm(baseKvOf(b.from), net.sBaseVA)
    return cx((b.rPerKm * b.lengthKm) / n / zb, (b.xPerKm * b.lengthKm) / n / zb)
  }
  return transformerZ1pu(b, net.sBaseVA)
}

export interface ZbusResult {
  index: Map<string, number>
  Z: Cx[][]
  connected: Set<string>
}

/** Buses that source a fault, given the included machines. */
function sourceBuses(net: MvNetwork, includeMotors: boolean): string[] {
  return [
    ...net.infeeds.map((i) => i.bus),
    ...(net.machines ?? []).filter((m) => m.kind === 'generator' || includeMotors).map((m) => m.bus),
  ]
}

/** Buses reachable from any source across closed branches. */
function connectedToSource(net: MvNetwork, includeMotors: boolean): Set<string> {
  const adj = new Map<string, string[]>()
  for (const bus of net.buses) adj.set(bus.id, [])
  for (const br of net.branches) {
    if (!br.closed) continue
    adj.get(br.from)?.push(br.to)
    adj.get(br.to)?.push(br.from)
  }
  const seen = new Set<string>()
  const stack = sourceBuses(net, includeMotors)
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) stack.push(nb)
  }
  return seen
}

/** Build Y over the connected sub-network and invert to Z. */
export function solveZbus(net: MvNetwork, opts: { includeMotors?: boolean } = {}): ZbusResult {
  const includeMotors = opts.includeMotors ?? true
  const connected = connectedToSource(net, includeMotors)
  const ids = net.buses.filter((b) => connected.has(b.id)).map((b) => b.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const Y: Cx[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => cx(0)))
  const baseKvOf = (id: string) => net.buses.find((b) => b.id === id)!.baseKv

  for (const br of net.branches) {
    if (!br.closed) continue
    const f = index.get(br.from)
    const t = index.get(br.to)
    if (f == null || t == null) continue
    const y = cinv(branchZpu(br, net, baseKvOf))
    Y[f][f] = cadd(Y[f][f], y)
    Y[t][t] = cadd(Y[t][t], y)
    Y[f][t] = csub(Y[f][t], y)
    Y[t][f] = csub(Y[t][f], y)
  }
  for (const inf of net.infeeds) {
    const i = index.get(inf.bus)
    if (i == null) continue
    Y[i][i] = cadd(Y[i][i], cinv(gridZ1pu(inf, net.sBaseVA)))
  }
  for (const m of net.machines ?? []) {
    if (m.kind === 'motor' && !includeMotors) continue
    const i = index.get(m.bus)
    if (i == null) continue
    Y[i][i] = cadd(Y[i][i], cinv(machineZ1pu(m, net.sBaseVA)))
  }
  return { index, Z: n > 0 ? matInvert(Y) : [], connected }
}

export type BusFault =
  | { busId: string; islanded: false; ik3MaxKa: number; ik3MinKa: number; xrRatio: number; ipKa: number; basis: string }
  | { busId: string; islanded: true; basis: string }

export function faultsForNetwork(net: MvNetwork): Record<string, BusFault> {
  const zMax = solveZbus(net, { includeMotors: true })
  const hasMotors = (net.machines ?? []).some((m) => m.kind === 'motor')
  const zMin = hasMotors ? solveZbus(net, { includeMotors: false }) : zMax

  const out: Record<string, BusFault> = {}
  for (const bus of net.buses) {
    if (!zMax.connected.has(bus.id)) {
      out[bus.id] = { busId: bus.id, islanded: true, basis: 'sandbox — no infeed (islanded)' }
      continue
    }
    const k = zMax.index.get(bus.id)!
    const zkk = zMax.Z[k][k]
    const ib = iBaseA(bus.baseKv, net.sBaseVA)
    const iNetA = (net.cMax / cabs(zkk)) * ib
    // IBR (inverter) current injection — a current-limited source, distributed to
    // this fault by the Z-bus transfer impedance |Z_kj|/|Z_kk|. Added to the max
    // fault only (excluded from min + earth fault); no DC offset in the peak.
    let iInvA = 0
    for (const inv of net.inverters ?? []) {
      const j = zMax.index.get(inv.bus)
      if (j == null) continue // inverter on a bus with no impedance-source path
      const transfer = Math.min(cabs(zMax.Z[k][j]) / cabs(zkk), 1) // ≤ 1: never more than the limit current reaches the fault
      iInvA += transfer * (inv.currentLimitFactor ?? 1.2) * (inv.sRatedVA / net.sBaseVA) * ib
    }
    const kMin = zMin.index.get(bus.id)
    const zkkMin = kMin != null ? zMin.Z[kMin][kMin] : zkk
    const xrRatio = zkk.im / zkk.re
    out[bus.id] = {
      busId: bus.id,
      islanded: false,
      ik3MaxKa: (iNetA + iInvA) / 1000,
      ik3MinKa: ((net.cMin / cabs(zkkMin)) * ib) / 1000,
      xrRatio,
      ipKa: (kappa(xrRatio) * Math.SQRT2 * iNetA + Math.SQRT2 * iInvA) / 1000,
      basis: 'sandbox — not for issue',
    }
  }
  return out
}
