/**
 * Incidence-angle modifier (engine spec §3.4): ASHRAE `IAM = 1 − b0 (1/cos θ − 1)`, clamped to
 * [0, 1], zero at θ ≥ 90°. Diffuse and ground-reflected light use the Brandemuehl & Beckman
 * equivalent incidence angles (Duffie & Beckman, Solar Engineering of Thermal Processes, eq. 5.4.1–2).
 */

const rad = (d: number) => (d * Math.PI) / 180

export function ashraeIam(aoiDeg: number, b0: number): number {
  if (aoiDeg >= 90) return 0
  const iam = 1 - b0 * (1 / Math.cos(rad(aoiDeg)) - 1)
  return Math.min(1, Math.max(0, iam))
}

/** Equivalent incidence angle of isotropic sky diffuse on a plane tilted β degrees. */
export function skyDiffuseEquivalentAoi(tiltDeg: number): number {
  return 59.7 - 0.1388 * tiltDeg + 0.001497 * tiltDeg ** 2
}

/** Equivalent incidence angle of ground-reflected light on a plane tilted β degrees. */
export function groundEquivalentAoi(tiltDeg: number): number {
  return 90 - 0.5788 * tiltDeg + 0.002693 * tiltDeg ** 2
}
