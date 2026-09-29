/**
 * Racked-row spacing (engine spec §3.1, decision D-11).
 *
 *   pitch = L_proj + d,  L_proj = L_slope·cos(tilt),  d = L_slope·sin(tilt)/tan(α)
 *
 * α is the solar elevation on 21 June at the SITE LATITUDE at the ends of the
 * shade-free window (default 09:00–15:00, org settings
 * row_spacing_shade_free_from_hour / _to_hour), taken as LOCAL SOLAR TIME
 * (hour angle 15° per hour from solar noon): the rule is a latitude rule, so it
 * does not depend on longitude or the SAST offset. The lower of the two ends
 * governs.
 */
export const JUNE_SOLSTICE_DECLINATION_DEG = 23.44

/** Below this elevation the gap explodes; the user must choose a pitch. */
const MIN_DESIGN_ELEVATION_DEG = 1

const rad = (d: number) => (d * Math.PI) / 180
const deg = (r: number) => (r * 180) / Math.PI

/**
 * Solar elevation on the WINTER solstice of the site's hemisphere: 21 June in
 * the south (D-11), 21 December (declination −23.44°) in the north, so a
 * northern latitude never designs against its summer sun.
 */
export function solsticeElevationDeg(latDeg: number, solarHour: number): number {
  const h = rad(15 * (solarHour - 12))
  const d = rad(latDeg > 0 ? -JUNE_SOLSTICE_DECLINATION_DEG : JUNE_SOLSTICE_DECLINATION_DEG)
  const phi = rad(latDeg)
  return deg(Math.asin(Math.sin(phi) * Math.sin(d) + Math.cos(phi) * Math.cos(d) * Math.cos(h)))
}

export function shadeFreeElevationDeg(latDeg: number, fromHour: number, toHour: number): number {
  return Math.min(solsticeElevationDeg(latDeg, fromHour), solsticeElevationDeg(latDeg, toHour))
}

export interface RowPitch {
  /** Module depth on plan. */
  projM: number
  /** Shading gap behind the row. */
  gapM: number
  pitchM: number
  /** Design solar elevation; null for a manual pitch. */
  alphaDeg: number | null
}

export function autoRowPitch(i: { slopeLengthM: number; tiltDeg: number; latDeg: number; fromHour: number; toHour: number }): RowPitch {
  const projM = i.slopeLengthM * Math.cos(rad(i.tiltDeg))
  const alphaDeg = shadeFreeElevationDeg(i.latDeg, i.fromHour, i.toHour)
  if (i.tiltDeg === 0) return { projM, gapM: 0, pitchM: projM, alphaDeg }
  if (!(alphaDeg > MIN_DESIGN_ELEVATION_DEG)) {
    throw new Error('The winter sun is too low at this latitude for the shade-free window; enter a manual row pitch.')
  }
  const gapM = (i.slopeLengthM * Math.sin(rad(i.tiltDeg))) / Math.tan(rad(alphaDeg))
  return { projM, gapM, pitchM: projM + gapM, alphaDeg }
}

export function manualRowPitch(i: { slopeLengthM: number; tiltDeg: number; pitchM: number }): RowPitch {
  const projM = i.slopeLengthM * Math.cos(rad(i.tiltDeg))
  if (!(i.pitchM >= projM)) {
    throw new Error(`A row pitch of ${i.pitchM} m is shorter than the module's own depth on plan (${projM.toFixed(2)} m).`)
  }
  return { projM, gapM: i.pitchM - projM, pitchM: i.pitchM, alphaDeg: null }
}
