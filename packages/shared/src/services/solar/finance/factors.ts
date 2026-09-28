/**
 * Year-indexed factors for the annual cashflow (engine spec §3.6, §6, §7). Year n runs 1…N.
 */

/** Degradation (spec §3.6), applied ONCE, here: Year-n energy = Year-1 × (1 − d₁) × (1 − d)^(n−1). */
export function degradationFactor(n: number, firstYear: number, annual: number): number {
  return (1 - firstYear) * (1 - annual) ** (n - 1)
}

/** CPI factor for year n: (1 + cpi)^(n−1). Year 1 is in today's money. */
export function cpiFactor(n: number, cpi: number): number {
  return (1 + cpi) ** (n - 1)
}

export interface EscalationPath {
  /** Approved increases for the years that have a published tariff, applied to years 2, 3, … in order. */
  published: readonly number[]
  /** Default path start (year 2) — spec §7 / D-07: 9 %. */
  startRate: number
  /** Default path value at `linearToYear` — 7 %. */
  endRate: number
  /** Year at which the linear path reaches `endRate` — 10. */
  linearToYear: number
  /** Rate after `linearToYear` = CPI + this margin (1 %). */
  cpiMargin: number
}

export const DEFAULT_ESCALATION: EscalationPath = {
  published: [],
  startRate: 0.09,
  endRate: 0.07,
  linearToYear: 10,
  cpiMargin: 0.01,
}

/** Tariff increase applied going INTO year n (n ≥ 2). */
export function escalationRate(n: number, path: EscalationPath, cpi: number): number {
  if (n < 2) return 0
  const pub = path.published[n - 2]
  if (pub !== undefined) return pub
  if (n <= path.linearToYear) {
    const span = path.linearToYear - 2
    return span <= 0 ? path.endRate : path.startRate + ((path.endRate - path.startRate) * (n - 2)) / span
  }
  return cpi + path.cpiMargin
}

/** Cumulative tariff factor for year n (1 in year 1). */
export function tariffFactors(years: number, path: EscalationPath, cpi: number): number[] {
  const out: number[] = []
  let f = 1
  for (let n = 1; n <= years; n++) {
    f *= 1 + escalationRate(n, path, cpi)
    out.push(f)
  }
  return out
}

/**
 * Battery usable-capacity factor for year n: fades linearly from 1 by `fadePerYear` to a floor
 * of `endOfLife`, and is renewed after a replacement at the END of `replacementYear`.
 */
export function batteryHealth(n: number, fadePerYear: number, endOfLife: number, replacementYear: number | null): number {
  const age = replacementYear !== null && n > replacementYear ? n - replacementYear - 1 : n - 1
  return Math.max(endOfLife, 1 - fadePerYear * age)
}
