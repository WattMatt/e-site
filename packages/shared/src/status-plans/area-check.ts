/**
 * Measured vs scheduled shop area (spec 2026-10-09 §3.1). Pure.
 * |measured − scheduled| / scheduled > 2 % raises the amber "area differs"
 * flag in the side panel and legend table, never on the drawing.
 */

export const AREA_TOLERANCE = 0.02

export type AreaCheckState = 'no_scale' | 'no_schedule' | 'matches' | 'differs'

export interface AreaCheck {
  state: AreaCheckState
  measuredM2: number | null
  scheduledM2: number | null
  /** measured − scheduled, m². */
  deltaM2: number | null
  /** (measured − scheduled) / scheduled × 100. */
  deltaPct: number | null
}

/** Absorbs binary noise at the exact 2 % boundary (e.g. 1809.27 × 1.02). */
const EPS = 1e-9

export function areaCheck(
  measuredM2: number | null,
  scheduledM2: number | null,
  tolerance: number = AREA_TOLERANCE,
): AreaCheck {
  if (measuredM2 === null) {
    return { state: 'no_scale', measuredM2: null, scheduledM2, deltaM2: null, deltaPct: null }
  }
  if (scheduledM2 === null || !(scheduledM2 > 0)) {
    return { state: 'no_schedule', measuredM2, scheduledM2, deltaM2: null, deltaPct: null }
  }
  const deltaM2 = measuredM2 - scheduledM2
  const ratio = deltaM2 / scheduledM2
  return {
    state: Math.abs(ratio) > tolerance + EPS ? 'differs' : 'matches',
    measuredM2,
    scheduledM2,
    deltaM2,
    deltaPct: ratio * 100,
  }
}

export function totalMeasuredM2(values: ReadonlyArray<number | null>): { totalM2: number; unmeasured: number } {
  let totalM2 = 0
  let unmeasured = 0
  for (const v of values) {
    if (v === null) unmeasured += 1
    else totalM2 += v
  }
  return { totalM2, unmeasured }
}
