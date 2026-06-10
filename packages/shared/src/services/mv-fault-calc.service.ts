/**
 * mv-fault-calc.service.ts — IEC 60909 fault levels (pure TS).
 *
 * Sandbox convention: the voltage factor c is applied ONCE, in the Ik formula.
 * Branch impedances (source / transformer / feeder) are physical — no per-branch
 * c / K_T / K_G corrections in v1. Re-validate against IEC 60909-0 §3.x before
 * any issued study. Decoupled from the cable-schedule domain.
 */

export interface Impedance {
  r: number // ohms, referred to study base
  x: number
}

export const magnitude = (z: Impedance): number => Math.hypot(z.r, z.x)

export const seriesSum = (zs: Impedance[]): Impedance =>
  zs.reduce((a, b) => ({ r: a.r + b.r, x: a.x + b.x }), { r: 0, x: 0 })

/** Split a magnitude into R + jX given an X/R ratio. */
export function splitByXR(magOhm: number, xr: number): Impedance {
  const r = magOhm / Math.hypot(1, xr)
  return { r, x: r * xr }
}

/** Utility source from short-circuit power: |Z| = U_n^2 / S_kQ". */
export function sourceImpedance(p: { unV: number; sscVA: number; xr: number }): Impedance {
  return splitByXR((p.unV * p.unV) / p.sscVA, p.xr)
}

/** Transformer: |Z_T| = (uk%/100)·U_n^2/S_rT; R from load loss Pk or uR%. */
export function transformerImpedance(p: {
  unV: number
  sRatedVA: number
  ukrPct: number
  pkrW?: number
  uRrPct?: number
}): Impedance {
  const zMag = ((p.ukrPct / 100) * (p.unV * p.unV)) / p.sRatedVA
  let r = 0
  if (p.pkrW != null) r = (p.pkrW * p.unV * p.unV) / (p.sRatedVA * p.sRatedVA)
  else if (p.uRrPct != null) r = ((p.uRrPct / 100) * (p.unV * p.unV)) / p.sRatedVA
  const x = Math.sqrt(Math.max(zMag * zMag - r * r, 0))
  return { r, x }
}

/** MV feeder: Z = (r + jx)·length / parallel. */
export function feederImpedance(p: {
  rPerKm: number
  xPerKm: number
  lengthKm: number
  parallel?: number
}): Impedance {
  const n = p.parallel ?? 1
  return { r: (p.rPerKm * p.lengthKm) / n, x: (p.xPerKm * p.lengthKm) / n }
}

/** IEC 60909 peak factor κ = 1.02 + 0.98·e^(−3·R/X). */
export const kappa = (xr: number): number => 1.02 + 0.98 * Math.exp(-3 / xr)

export interface FaultPoint {
  ik3A: number
  xr: number
  ipA: number
}

/** Three-phase fault at a node from the accumulated series impedance Z_k. */
export function faultAtNode(p: { zk: Impedance; unV: number; c: number }): FaultPoint {
  const z = magnitude(p.zk)
  const ik3A = (p.c * p.unV) / (Math.sqrt(3) * z)
  const xr = p.zk.x / p.zk.r
  return { ik3A, xr, ipA: kappa(xr) * Math.SQRT2 * ik3A }
}

// --- Study reduction (radial source→node walk) ------------------------------

export interface StudyNode {
  id: string
  parentId: string | null
  unV?: number
  feeder?: Parameters<typeof feederImpedance>[0]
  transformer?: Parameters<typeof transformerImpedance>[0]
}

export interface FaultRow {
  ik3MaxKa: number
  ik3MinKa: number
  xrRatio: number
  ipKa: number
  basis: string
}

export interface StudyInput {
  source: Parameters<typeof sourceImpedance>[0]
  cMax: number
  cMin: number
  nodes: StudyNode[]
}

/** Compute per-node fault rows by accumulating series impedance from source. */
export function faultResultsForStudy(study: StudyInput): Record<string, FaultRow> {
  const zSource = sourceImpedance(study.source)
  const byId = new Map(study.nodes.map((n) => [n.id, n]))

  const accum = (id: string): Impedance[] => {
    const n = byId.get(id)
    if (!n) throw new Error(`faultResultsForStudy: unknown node ${id}`)
    const here: Impedance[] = []
    if (n.feeder) here.push(feederImpedance(n.feeder))
    if (n.transformer) here.push(transformerImpedance(n.transformer))
    return n.parentId ? [...accum(n.parentId), ...here] : [zSource, ...here]
  }

  const out: Record<string, FaultRow> = {}
  for (const n of study.nodes) {
    const zk = seriesSum(accum(n.id))
    const un = n.unV ?? study.source.unV
    const max = faultAtNode({ zk, unV: un, c: study.cMax })
    const min = faultAtNode({ zk, unV: un, c: study.cMin })
    out[n.id] = {
      ik3MaxKa: max.ik3A / 1000,
      ik3MinKa: min.ik3A / 1000,
      xrRatio: max.xr,
      ipKa: max.ipA / 1000,
      basis: 'sandbox — not for issue',
    }
  }
  return out
}
