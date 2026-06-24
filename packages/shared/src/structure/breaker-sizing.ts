/**
 * breaker-sizing.ts — pure breaker selection for tenant incoming supplies.
 *
 * Load-based sizing: the incomer's design load is rounded UP to the next standard
 * breaker rating. Pole configuration is inferred from the cable cores. A SANS
 * 10142-1 coordination check flags when the chosen breaker would exceed what the
 * conductor can carry (I_load <= I_breaker <= I_cable).
 *
 * No I/O — fully unit-testable.
 */

/**
 * Standard SANS/IEC 60898 / 60947-2 preferred breaker current ratings (amps).
 */
export const STANDARD_BREAKER_SERIES = [
  6, 10, 16, 20, 25, 32, 40, 50, 63, 80, 100, 125, 160, 200, 250, 315, 400, 630,
  800, 1000, 1250, 1600,
] as const

export type PoleConfig = 'SP' | 'TP'

/** Smallest standard breaker >= amps, or null if amps is invalid or over-range. */
export function nextStandardBreaker(amps: number | null): number | null {
  if (amps == null || !Number.isFinite(amps) || amps <= 0) return null
  for (const size of STANDARD_BREAKER_SERIES) {
    if (size >= amps) return size
  }
  return null
}

/** TP for three-phase cores (3 / 3+E / 4); SP otherwise; null when cores unknown. */
export function poleConfigFromCores(cores: string | null): PoleConfig | null {
  if (cores == null) return null
  return cores === '3' || cores === '3+E' || cores === '4' ? 'TP' : 'SP'
}

export interface DeriveIncomerBreakerInput {
  designLoadA: number | null
  cores: string | null
  capacityA: number | null
}

export interface DerivedBreaker {
  breakerA: number | null
  poleConfig: PoleConfig | null
  underProtected: boolean
}

/** Load-based breaker sizing with SANS 10142-1 coordination flag. */
export function deriveIncomerBreaker(input: DeriveIncomerBreakerInput): DerivedBreaker {
  const breakerA = nextStandardBreaker(input.designLoadA)
  const poleConfig = poleConfigFromCores(input.cores)
  const underProtected =
    breakerA != null && input.capacityA != null && breakerA > input.capacityA
  return { breakerA, poleConfig, underProtected }
}
