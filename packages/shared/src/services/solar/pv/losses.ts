/**
 * DC loss chain (engine spec §3.5): L_dc = 1 − Π(1 − l_i). Losses are MULTIPLICATIVE — WM Solar
 * displayed an additive sum beside a multiplicative calculation.
 * Every loss is a fraction in [0, 1).
 */

export interface DcLosses {
  soiling: number
  shading: number
  mismatch: number
  dcWiring: number
  lid: number
  nameplate: number
}

export interface AcLosses {
  acWiring: number
  /** Availability as a fraction, e.g. 0.99. */
  availability: number
}

/** Engine spec §7 defaults. Shading is the "no obstructions drawn" value for flush mount. */
export const DEFAULT_DC_LOSSES: DcLosses = {
  soiling: 0.02,
  shading: 0.01,
  mismatch: 0.01,
  dcWiring: 0.015,
  lid: 0.015,
  nameplate: 0,
}
export const DEFAULT_SHADING_RACKED = 0.03
export const DEFAULT_AC_LOSSES: AcLosses = { acWiring: 0.01, availability: 0.99 }

function check(name: string, v: number): void {
  if (!Number.isFinite(v) || v < 0 || v >= 1) throw new Error(`loss ${name} must be a fraction in [0, 1), got ${v}`)
}

/** Combined DC loss fraction. */
export function combinedDcLoss(l: DcLosses): number {
  let keep = 1
  for (const [k, v] of Object.entries(l)) {
    check(k, v)
    keep *= 1 - v
  }
  return 1 - keep
}

/** Multiplier applied after the inverter: (1 − AC wiring) × availability. */
export function acFactor(l: AcLosses): number {
  check('acWiring', l.acWiring)
  if (!Number.isFinite(l.availability) || l.availability <= 0 || l.availability > 1) {
    throw new Error(`availability must be in (0, 1], got ${l.availability}`)
  }
  return (1 - l.acWiring) * l.availability
}
