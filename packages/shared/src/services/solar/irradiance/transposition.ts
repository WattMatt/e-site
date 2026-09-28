/**
 * Plane-of-array irradiance (engine spec §3.4).
 *
 * Perez et al. 1990 ("Modeling daylight availability and irradiance components from direct and
 * global irradiance", Solar Energy 44(5)) with the "allsitescomposite1990" coefficient set, as
 * tabulated in pvlib-python `irradiance.py` (BSD-3-Clause). Hay & Davies 1980 is the fallback.
 * Angles in degrees; azimuths clockwise from north (spec §3.2).
 */

const rad = (d: number) => (d * Math.PI) / 180

/** cos(angle of incidence) between the sun and a surface normal (may be negative). */
export function cosAoi(tiltDeg: number, surfaceAzDeg: number, zenithDeg: number, sunAzDeg: number): number {
  const z = rad(zenithDeg)
  const t = rad(tiltDeg)
  return Math.cos(z) * Math.cos(t) + Math.sin(z) * Math.sin(t) * Math.cos(rad(sunAzDeg - surfaceAzDeg))
}

/** Extraterrestrial normal irradiance, W/m² (Spencer 1971, solar constant 1366.1). dayOfYear 1…365. */
export function extraterrestrialDni(dayOfYear: number): number {
  const b = (2 * Math.PI * (dayOfYear - 1)) / 365
  return (
    1366.1 *
    (1.00011 + 0.034221 * Math.cos(b) + 0.00128 * Math.sin(b) + 0.000719 * Math.cos(2 * b) + 0.000077 * Math.sin(2 * b))
  )
}

/** Relative (not pressure-corrected) air mass, Kasten & Young 1989. NaN when the sun is down. */
export function relativeAirmass(zenithDeg: number): number {
  if (zenithDeg >= 90) return NaN
  return 1 / (Math.cos(rad(zenithDeg)) + 0.50572 * (96.07995 - zenithDeg) ** -1.6364)
}

// [f11, f12, f13, f21, f22, f23] per sky-clearness bin (allsitescomposite1990).
const PEREZ: readonly (readonly number[])[] = [
  [-0.008, 0.588, -0.062, -0.06, 0.072, -0.022],
  [0.13, 0.683, -0.151, -0.019, 0.066, -0.029],
  [0.33, 0.487, -0.221, 0.055, -0.064, -0.026],
  [0.568, 0.187, -0.295, 0.109, -0.152, -0.014],
  [0.873, -0.392, -0.362, 0.226, -0.462, 0.001],
  [1.132, -1.237, -0.412, 0.288, -0.823, 0.056],
  [1.06, -1.6, -0.359, 0.264, -1.127, 0.131],
  [0.678, -0.327, -0.25, 0.156, -1.377, 0.251],
]
const EPS_BINS = [1.065, 1.23, 1.5, 1.95, 2.8, 4.5, 6.2]

export interface SkyInput {
  tiltDeg: number
  cosAoi: number
  zenithDeg: number
  dni: number
  dhi: number
  dniExtra: number
  airmass: number
}

const isotropic = (dhi: number, tiltDeg: number) => (dhi * (1 + Math.cos(rad(tiltDeg)))) / 2

/** Perez 1990 sky diffuse on the tilted plane, W/m². Isotropic when the sun is below the horizon. */
export function perezSkyDiffuse(i: SkyInput): number {
  if (i.dhi <= 0) return 0
  if (i.zenithDeg >= 90 || !Number.isFinite(i.airmass)) return isotropic(i.dhi, i.tiltDeg)
  const kappa = 1.041
  const z = rad(i.zenithDeg)
  const eps = ((i.dhi + i.dni) / i.dhi + kappa * z ** 3) / (1 + kappa * z ** 3)
  let bin = 0
  while (bin < EPS_BINS.length && eps >= EPS_BINS[bin]!) bin++
  const f = PEREZ[bin]!
  const delta = (i.dhi * i.airmass) / i.dniExtra
  const F1 = Math.max(0, f[0]! + f[1]! * delta + z * f[2]!)
  const F2 = f[3]! + f[4]! * delta + z * f[5]!
  const a = Math.max(0, i.cosAoi)
  const b = Math.max(Math.cos(rad(85)), Math.cos(z))
  const t = rad(i.tiltDeg)
  const sky = i.dhi * ((1 - F1) * (1 + Math.cos(t)) * 0.5 + (F1 * a) / b + F2 * Math.sin(t))
  return Math.max(0, sky)
}

/** Hay & Davies 1980 sky diffuse on the tilted plane, W/m². */
export function hayDaviesSkyDiffuse(i: SkyInput): number {
  if (i.dhi <= 0) return 0
  if (i.zenithDeg >= 90) return isotropic(i.dhi, i.tiltDeg)
  const ai = Math.min(1, i.dni / i.dniExtra)
  const rb = Math.max(0, i.cosAoi) / Math.max(Math.cos(rad(85)), Math.cos(rad(i.zenithDeg)))
  return Math.max(0, i.dhi * (ai * rb + (1 - ai) * (1 + Math.cos(rad(i.tiltDeg))) * 0.5))
}

/** Ground-reflected irradiance on the tilted plane, W/m². */
export function groundReflected(ghi: number, albedo: number, tiltDeg: number): number {
  return (ghi * albedo * (1 - Math.cos(rad(tiltDeg)))) / 2
}

/** Beam on the plane: DNI × cos(AOI) for AOI < 90° and the sun above the horizon. */
export function beamOnPlane(dni: number, cosAoiValue: number, zenithDeg: number): number {
  return zenithDeg < 90 && cosAoiValue > 0 ? dni * cosAoiValue : 0
}
