/**
 * mv-zeroseq.service.ts — zero-sequence network + single-line-to-ground (SLG)
 * earth-fault current Ik1 (pure TS).
 *
 * Ik1 = 3·c / |2·Z1_kk + Z0_kk|  (per-unit; Z2 ≈ Z1). Z1_kk is the existing
 * positive-sequence Z-bus diagonal; Z0_kk is a second nodal solve on a
 * zero-sequence network built from transformer vector groups + earthing.
 * Sandbox convention: c applied once; YNyn lumps 3·Z_N in series; nominal taps.
 */
import { cx, cadd, csub, cinv, cabs, matInvert, type Cx } from './mv-complex'
import { solveZbus, transformerZ1pu, gridZ1pu } from './mv-fault.service'
import type { MvNetwork, NeutralEarthing } from './mv-protection.types'

const SQRT3 = Math.sqrt(3)
const zBaseOhm = (kv: number, sBase: number) => (kv * 1000) ** 2 / sBase
const scale = (z: Cx, k: number): Cx => ({ re: z.re * k, im: z.im * k })

/** 3·Z_N (per-unit on the star-side bus) as a complex impedance. Solid ⇒ 0. */
function threeZn(e: NeutralEarthing | undefined, kvStar: number, sBase: number): Cx {
  if (!e || e.kind === 'solid' || e.ohms == null) return cx(0)
  const pu = (3 * e.ohms) / zBaseOhm(kvStar, sBase)
  return e.kind === 'reactance' ? cx(0, pu) : cx(pu, 0)
}

export interface VgClass {
  kind: 'series' | 'shunt' | 'open'
  shuntSide?: 'from' | 'to'
}

/**
 * Convention: '<from-winding><to-winding>'; earthed-star side = YN/ZN, delta = D.
 * Clock digits ignored.
 *
 * An earthed-star winding presents a LOW-impedance zero-sequence shunt on its own
 * side ONLY when the other winding is a delta — the delta carries the balancing
 * circulating current. Paired with a plain (unearthed) winding the zero-sequence
 * MMF is balanced by the magnetising branch only (very high Z0), so YNy / Yyn are
 * treated as open, not a Z0=Z1 shunt. Both earthed (YNyn, ZNyn) → series.
 *
 * NOTE (Pr.Eng review): this corrects the earlier rule that granted a shunt to any
 * earthed winding. It changes YNy/Yyn from a (too-low-Z0) shunt to open; a 3-limb
 * core has a finite high Z0 the user can model with an earthing transformer.
 */
export function classifyVectorGroup(vg: string): VgClass {
  const s = vg.toUpperCase().replace(/[0-9]/g, '')
  const fromTok = s.match(/^(YN|ZN|Y|Z|D)/)?.[0] ?? ''
  const toTok = s.slice(fromTok.length).match(/^(YN|ZN|Y|Z|D)/)?.[0] ?? ''
  const earthed = (t: string) => t === 'YN' || t === 'ZN'
  const isDelta = (t: string) => t === 'D'
  if (earthed(fromTok) && earthed(toTok)) return { kind: 'series' }
  if (earthed(fromTok) && isDelta(toTok)) return { kind: 'shunt', shuntSide: 'from' }
  if (earthed(toTok) && isDelta(fromTok)) return { kind: 'shunt', shuntSide: 'to' }
  return { kind: 'open' }
}

interface Z0Series {
  from: string
  to: string
  z: Cx
}
interface Z0Shunt {
  bus: string
  z: Cx
}

export function buildZ0Elements(net: MvNetwork): { series: Z0Series[]; shunts: Z0Shunt[] } {
  const series: Z0Series[] = []
  const shunts: Z0Shunt[] = []
  const kvOf = (id: string) => net.buses.find((b) => b.id === id)!.baseKv

  for (const br of net.branches) {
    if (!br.closed) continue
    if (br.kind === 'line') {
      const r0 = br.r0PerKm ?? 3 * br.rPerKm
      const x0 = br.x0PerKm ?? 3 * br.xPerKm
      const n = br.parallel ?? 1
      const zb = zBaseOhm(kvOf(br.from), net.sBaseVA)
      series.push({ from: br.from, to: br.to, z: cx((r0 * br.lengthKm) / n / zb, (x0 * br.lengthKm) / n / zb) })
    } else {
      const z0t = scale(transformerZ1pu(br, net.sBaseVA), br.z0OverZ1 ?? 1)
      const c = classifyVectorGroup(br.vectorGroup ?? 'Dyn')
      if (c.kind === 'series') {
        const zn = cadd(
          threeZn(br.neutralEarthing, kvOf(br.from), net.sBaseVA),
          threeZn(br.neutralEarthing, kvOf(br.to), net.sBaseVA),
        )
        series.push({ from: br.from, to: br.to, z: cadd(z0t, zn) })
      } else if (c.kind === 'shunt') {
        const bus = c.shuntSide === 'from' ? br.from : br.to
        shunts.push({ bus, z: cadd(z0t, threeZn(br.neutralEarthing, kvOf(bus), net.sBaseVA)) })
      }
    }
  }
  for (const inf of net.infeeds) {
    shunts.push({ bus: inf.bus, z: scale(gridZ1pu(inf, net.sBaseVA), inf.z0OverZ1 ?? 1) })
  }
  for (const et of net.earthingTransformers ?? []) {
    const zb = zBaseOhm(kvOf(et.bus), net.sBaseVA)
    shunts.push({ bus: et.bus, z: cadd(cx(0, et.z0Ohm / zb), threeZn(et.earthing, kvOf(et.bus), net.sBaseVA)) })
  }
  return { series, shunts }
}

export interface Z0Result {
  index: Map<string, number>
  Z0: Cx[][]
  grounded: Set<string>
}

/** Buses connected (via Z0 series) to any bus carrying a shunt-to-ground. */
function z0Connected(net: MvNetwork, series: Z0Series[], shunts: Z0Shunt[]): Set<string> {
  const adj = new Map<string, string[]>()
  for (const b of net.buses) adj.set(b.id, [])
  for (const s of series) {
    adj.get(s.from)?.push(s.to)
    adj.get(s.to)?.push(s.from)
  }
  const seen = new Set<string>()
  const stack = shunts.map((s) => s.bus)
  while (stack.length) {
    const id = stack.pop()!
    if (seen.has(id)) continue
    seen.add(id)
    for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) stack.push(nb)
  }
  return seen
}

export function solveZ0bus(net: MvNetwork): Z0Result {
  const { series, shunts } = buildZ0Elements(net)
  const grounded = z0Connected(net, series, shunts)
  const ids = net.buses.filter((b) => grounded.has(b.id)).map((b) => b.id)
  const index = new Map(ids.map((id, i) => [id, i]))
  const n = ids.length
  const Y: Cx[][] = Array.from({ length: n }, () => Array.from({ length: n }, () => cx(0)))
  for (const s of series) {
    const f = index.get(s.from)
    const t = index.get(s.to)
    if (f == null || t == null) continue
    const y = cinv(s.z)
    Y[f][f] = cadd(Y[f][f], y)
    Y[t][t] = cadd(Y[t][t], y)
    Y[f][t] = csub(Y[f][t], y)
    Y[t][f] = csub(Y[t][f], y)
  }
  for (const sh of shunts) {
    const i = index.get(sh.bus)
    if (i == null) continue
    Y[i][i] = cadd(Y[i][i], cinv(sh.z))
  }
  return { index, Z0: n > 0 ? matInvert(Y) : [], grounded }
}

export type EarthFault =
  | { busId: string; ik1Ka: number; ik1MinKa: number; basis: string }
  | { busId: string; noEarthPath: true; icAmps?: number; basis: string }

/** Buses galvanically connected to `start` through closed lines only (transformers block Z0). */
function lineGalvanicGroup(net: MvNetwork, start: string): Set<string> {
  const adj = new Map<string, string[]>()
  for (const b of net.buses) adj.set(b.id, [])
  for (const br of net.branches) {
    if (br.kind !== 'line' || !br.closed) continue
    adj.get(br.from)?.push(br.to)
    adj.get(br.to)?.push(br.from)
  }
  const seen = new Set([start])
  const stack = [start]
  while (stack.length) {
    const id = stack.pop()!
    for (const nb of adj.get(id) ?? []) if (!seen.has(nb)) { seen.add(nb); stack.push(nb) }
  }
  return seen
}

/**
 * Steady-state capacitive earth-fault current (A) for an unearthed bus:
 * I_c = √3·ω·C0·U_n, with C0 the total phase-to-earth capacitance of the
 * galvanic (line-only) group containing the bus. Undefined if no line carries C0 data.
 */
function capacitiveEarthFaultAmps(net: MvNetwork, busId: string): number | undefined {
  const group = lineGalvanicGroup(net, busId)
  let c0F = 0
  let any = false
  for (const br of net.branches) {
    if (br.kind !== 'line' || !br.closed || br.c0nFPerKm == null) continue
    if (!group.has(br.from) && !group.has(br.to)) continue
    any = true
    c0F += br.c0nFPerKm * 1e-9 * br.lengthKm * (br.parallel ?? 1)
  }
  if (!any) return undefined
  const baseKv = net.buses.find((b) => b.id === busId)!.baseKv
  const w = 2 * Math.PI * 50
  return SQRT3 * w * c0F * (baseKv * 1000)
}

/**
 * Per-bus SLG earth fault. ik1Ka is the maximum (c_max, bolted, all infeeds);
 * ik1MinKa is the minimum / EF-sensitivity case (c_min, motors excluded, plus an
 * assumed earth-fault resistance net.efFaultResistanceOhm entering the loop as 3·R_F).
 * The minimum is what an EF relay's sensitivity/reach must be checked against —
 * a resistive earth fault collapses Ik1 far below the bolted value.
 */
export function earthFaultForNetwork(net: MvNetwork): Record<string, EarthFault> {
  const z1max = solveZbus(net, { includeMotors: true })
  const hasMotors = (net.machines ?? []).some((m) => m.kind === 'motor')
  const z1min = hasMotors ? solveZbus(net, { includeMotors: false }) : z1max
  const z0 = solveZ0bus(net)
  const rfOhm = net.efFaultResistanceOhm ?? 0
  const out: Record<string, EarthFault> = {}
  for (const bus of net.buses) {
    const i1 = z1max.index.get(bus.id)
    const i0 = z0.index.get(bus.id)
    if (i1 == null) {
      out[bus.id] = { busId: bus.id, noEarthPath: true, basis: 'sandbox — no source (islanded)' }
      continue
    }
    if (i0 == null) {
      const icAmps = capacitiveEarthFaultAmps(net, bus.id)
      out[bus.id] = {
        busId: bus.id,
        noEarthPath: true,
        icAmps,
        basis: icAmps != null ? 'sandbox — unearthed: capacitive earth-fault only' : 'sandbox — no earth path (unearthed; provide line C0 to quantify)',
      }
      continue
    }
    const ib = net.sBaseVA / (SQRT3 * bus.baseKv * 1000)
    const z0kk = z0.Z0[i0][i0]
    // Maximum: c_max, bolted (R_F = 0), all infeeds incl. motors.
    const denomMax = cadd(scale(z1max.Z[i1][i1], 2), z0kk)
    const ik1Ka = ((3 * net.cMax) / cabs(denomMax)) * (ib / 1000)
    // Minimum (EF sensitivity): c_min, motors excluded, + 3·R_F resistive earth path.
    const km = z1min.index.get(bus.id)
    const z1minKk = km != null ? z1min.Z[km][km] : z1max.Z[i1][i1]
    const threeRf = cx((3 * rfOhm) / zBaseOhm(bus.baseKv, net.sBaseVA), 0)
    const denomMin = cadd(cadd(scale(z1minKk, 2), z0kk), threeRf)
    const ik1MinKa = ((3 * net.cMin) / cabs(denomMin)) * (ib / 1000)
    out[bus.id] = { busId: bus.id, ik1Ka, ik1MinKa, basis: 'sandbox — not for issue' }
  }
  return out
}
