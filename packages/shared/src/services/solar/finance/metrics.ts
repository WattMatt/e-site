/**
 * Investment metrics (engine spec §6). `flows[0]` is year 0 (the upfront flow), `flows[n]` year n.
 */

export function npv(rate: number, flows: readonly number[]): number {
  let v = 0
  for (let n = 0; n < flows.length; n++) v += flows[n]! / (1 + rate) ** n
  return v
}

export const IRR_LOW = -0.99
export const IRR_HIGH = 2.0

/**
 * IRR by bracketed bisection on [−99 %, 200 %]. The bracket is scanned in 1 %-point steps for
 * the first sign change; `null` ("n/a") when there is none.
 */
export function irr(flows: readonly number[]): number | null {
  const step = 0.01
  let lo = IRR_LOW
  let fLo = npv(lo, flows)
  if (fLo === 0) return lo
  for (let hi = lo + step; hi <= IRR_HIGH + 1e-12; hi += step) {
    const fHi = npv(hi, flows)
    if (fHi === 0) return hi
    if (Math.sign(fHi) !== Math.sign(fLo)) {
      let a = lo
      let b = hi
      let fa = fLo
      for (let i = 0; i < 200 && b - a > 1e-12; i++) {
        const m = (a + b) / 2
        const fm = npv(m, flows)
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m
          fa = fm
        } else b = m
      }
      return (a + b) / 2
    }
    lo = hi
    fLo = fHi
  }
  return null
}

/**
 * Payback: the (interpolated) year in which cumulative flow first reaches zero. With `rate`,
 * flows are discounted first (discounted payback). `null` if never; 0 if the upfront flow is ≥ 0.
 */
export function payback(flows: readonly number[], rate = 0): number | null {
  let cum = flows[0]!
  if (cum >= 0) return 0
  for (let n = 1; n < flows.length; n++) {
    const f = flows[n]! / (1 + rate) ** n
    if (cum + f >= 0) return n - 1 + -cum / f
    cum += f
  }
  return null
}

/** Discounted LCOE = (capex + Σ PV(costs_n)) / Σ PV(energy_n), n = 1…N. */
export function lcoe(rate: number, capex: number, costs: readonly number[], energyKwh: readonly number[]): number | null {
  let pvCost = capex
  let pvEnergy = 0
  for (let i = 0; i < energyKwh.length; i++) {
    const d = (1 + rate) ** (i + 1)
    pvCost += (costs[i] ?? 0) / d
    pvEnergy += energyKwh[i]! / d
  }
  return pvEnergy > 0 ? pvCost / pvEnergy : null
}
