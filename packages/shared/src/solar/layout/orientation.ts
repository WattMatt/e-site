/**
 * Directions on the sheet vs true azimuth (engine spec §3.2).
 *
 * A SHEET BEARING is degrees clockwise from sheet-up. The north reference of a
 * roof source (solar.roof_sources.north_bearing_deg) is the sheet bearing that
 * points to true north. A TRUE AZIMUTH is 0 = north, 90 = east, clockwise.
 *   azimuth = sheetBearing − northBearing   (mod 360)
 * Check: north up (0) and a direction pointing sheet-down (180) → 180, south.
 */
import type { ArrayProps, Pt } from './types'

export function mod360(deg: number): number {
  const r = ((deg % 360) + 360) % 360
  return r === 360 ? 0 : r
}

/** Unit vector in IMAGE coordinates (x right, y down) for a sheet bearing. */
export function sheetDirection(bearingDeg: number): Pt {
  const r = (bearingDeg * Math.PI) / 180
  return { x: Math.sin(r), y: -Math.cos(r) }
}

/** Sheet bearing of the vector from `a` to `b`. */
export function sheetBearing(a: Pt, b: Pt): number {
  return mod360((Math.atan2(b.x - a.x, -(b.y - a.y)) * 180) / Math.PI)
}

export function trueAzimuth(sheetBearingDeg: number, northBearingDeg: number): number {
  return mod360(sheetBearingDeg - northBearingDeg)
}

export function sheetBearingForAzimuth(azimuthDeg: number, northBearingDeg: number): number {
  return mod360(azimuthDeg + northBearingDeg)
}

/** The default facing for racked rows: towards the equator. */
export function equatorFacingAzimuth(latDeg: number): number {
  return latDeg < 0 ? 0 : 180
}

/** The azimuth the simulation uses for this array, or null while no north reference exists (§6.3 "Set north"). */
export function arrayAzimuth(props: ArrayProps, northBearingDeg: number | null): number | null {
  if (props.azimuthOverrideDeg !== null) return mod360(props.azimuthOverrideDeg)
  if (northBearingDeg === null) return null
  return trueAzimuth(props.facingSheetDeg, northBearingDeg)
}
