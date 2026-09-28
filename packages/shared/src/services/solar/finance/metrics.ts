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

/** Tie-break among several IRRs of the right kind (see `irr`): the one closest to this rate. */
export const IRR_GUESS = 0.1

/**
 * IRR by bracketed bisection on [−99 %, 200 %]. The WHOLE bracket is scanned in 1 %-point steps
 * (an integer grid, so no float drift), every sign change is bisected, and the investment's root
 * (NPV falling through zero) is returned. Taking the first sign change from −99 % is wrong: near −99 % the last
 * flow dominates (it is divided by 0.01ⁿ), so a negative final-year flow — a late replacement —
 * produces a spurious root there. `null` ("n/a") when there is no root, or when any flow is
 * non-finite or every flow is zero.
 */
export function irr(flows: readonly number[]): number | null {
  if (flows.length === 0 || flows.some((f) => !Number.isFinite(f)) || flows.every((f) => f === 0)) return null
  const step = 0.01
  const steps = Math.round((IRR_HIGH - IRR_LOW) / step)
  const rate = (k: number) => IRR_LOW + k * step
  const roots: number[] = []
  let fLo = npv(rate(0), flows)
  if (fLo === 0) roots.push(rate(0))
  for (let k = 1; k <= steps; k++) {
    const hi = rate(k)
    const fHi = npv(hi, flows)
    if (fHi === 0) roots.push(hi)
    else if (fLo !== 0 && Math.sign(fHi) !== Math.sign(fLo)) {
      let a = rate(k - 1)
      let b = hi
      let fa = fLo
      for (let i = 0; i < 200 && b - a > 1e-12; i++) {
        const m = (a + b) / 2
        const fm = npv(m, flows)
        if (fm === 0) {
          a = b = m
          break
        }
        if (Math.sign(fm) === Math.sign(fa)) {
          a = m
          fa = fm
        } else b = m
      }
      roots.push((a + b) / 2)
    }
    fLo = fHi
  }
  if (roots.length === 0) return null
  // Several roots: an investment (first non-zero flow negative) earns its IRR where NPV FALLS
  // through zero as the rate rises; a spurious root created by a negative final flow is a RISING
  // crossing. Borrowing-type flows mirror this. Among the roots of the right kind, the one closest
  // to IRR_GUESS wins; if none is of the right kind, all roots compete.
  const investment = flows.find((f) => f !== 0)! < 0
  const h = 1e-6
  const slope = (r: number) => npv(r + h, flows) - npv(r - h, flows)
  const preferred = roots.filter((r) => (investment ? slope(r) < 0 : slope(r) > 0))
  const pool = preferred.length > 0 ? preferred : roots
  return pool.reduce((best, r) => (Math.abs(r - IRR_GUESS) < Math.abs(best - IRR_GUESS) ? r : best))
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
