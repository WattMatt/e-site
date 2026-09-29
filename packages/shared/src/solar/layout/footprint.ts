/**
 * A module's footprint on PLAN (engine spec §3.1).
 *
 * "Along" is the facing direction (down the fall line for flush, the row
 * normal for racked); "across" is perpendicular to it.
 *   flush:  along = slope side × cos(roof pitch)  ← foreshortened
 *           across = the other side               ← NOT foreshortened
 *           (WM applied cos(pitch) across the slope; that is the bug pinned by
 *           footprint.test.ts and the pitched-roof case in packing.test.ts.)
 *   racked: along = slope side × cos(rack tilt); rows repeat every rowPitchM.
 * For flush, `tiltDeg` IS the roof pitch.
 */
import type { LayoutModuleSpec, ModuleOrientation, MountingKind } from './types'

export interface Footprint {
  /** The module side that runs up the slope, metres (true length). */
  slopeLengthM: number
  acrossM: number
  alongM: number
  stepAcrossM: number
  stepAlongM: number
}

export function moduleFootprint(i: {
  module: LayoutModuleSpec
  orientation: ModuleOrientation
  mounting: MountingKind
  tiltDeg: number
  gapM: number
  rowPitchM: number | null
}): Footprint {
  if (!(i.module.lengthM > 0 && i.module.widthM > 0)) throw new Error('The module size must be positive.')
  if (!(i.tiltDeg >= 0 && i.tiltDeg < 90)) throw new Error('The tilt must be at least 0° and less than 90°.')
  if (!(i.gapM >= 0)) throw new Error('The module gap cannot be negative.')
  const slope = i.orientation === 'portrait' ? i.module.lengthM : i.module.widthM
  const across = i.orientation === 'portrait' ? i.module.widthM : i.module.lengthM
  const cos = Math.cos((i.tiltDeg * Math.PI) / 180)
  const alongM = slope * cos
  if (i.mounting === 'flush') {
    return { slopeLengthM: slope, acrossM: across, alongM, stepAcrossM: across + i.gapM, stepAlongM: (slope + i.gapM) * cos }
  }
  if (i.rowPitchM === null || !(i.rowPitchM >= alongM)) {
    throw new Error('Racked rows need a row pitch at least the module depth on plan.')
  }
  return { slopeLengthM: slope, acrossM: across, alongM, stepAcrossM: across + i.gapM, stepAlongM: i.rowPitchM }
}
