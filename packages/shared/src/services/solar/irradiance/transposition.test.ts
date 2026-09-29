import { describe, expect, it } from 'vitest'
import {
  beamOnPlane,
  cosAoi,
  extraterrestrialDni,
  groundReflected,
  hayDaviesSkyDiffuse,
  perezSkyDiffuse,
  relativeAirmass,
  type SkyInput,
} from './transposition'
import { ashraeIam, groundEquivalentAoi, skyDiffuseEquivalentAoi } from './iam'

const clear = (over: Partial<SkyInput> = {}): SkyInput => ({
  tiltDeg: 30,
  cosAoi: cosAoi(30, 0, 40, 10),
  zenithDeg: 40,
  dni: 850,
  dhi: 110,
  dniExtra: 1400,
  airmass: relativeAirmass(40),
  ...over,
})

describe('geometry', () => {
  it('cos AOI of a horizontal plane is cos(zenith); a plane facing the sun sees 1', () => {
    expect(cosAoi(0, 0, 60, 123)).toBeCloseTo(0.5, 12)
    expect(cosAoi(35, 20, 35, 20)).toBeCloseTo(1, 12)
  })

  it('extraterrestrial DNI peaks near perihelion (January) and dips in July', () => {
    expect(extraterrestrialDni(3)).toBeGreaterThan(1410)
    expect(extraterrestrialDni(185)).toBeLessThan(1325)
  })

  it('Kasten–Young air mass: ≈1 overhead, ≈2 at 60°, NaN below the horizon', () => {
    expect(relativeAirmass(0)).toBeCloseTo(0.99970, 4)
    expect(relativeAirmass(60)).toBeCloseTo(1.99427, 4)
    expect(relativeAirmass(91)).toBeNaN()
  })

  it('beam on plane is DNI × cos AOI, zero behind the plane or below the horizon', () => {
    expect(beamOnPlane(800, 0.5, 30)).toBe(400)
    expect(beamOnPlane(800, -0.2, 30)).toBe(0)
    expect(beamOnPlane(800, 0.5, 95)).toBe(0)
  })

  it('ground reflected = GHI × albedo × (1 − cos β)/2', () => {
    expect(groundReflected(1000, 0.2, 0)).toBe(0)
    expect(groundReflected(1000, 0.2, 90)).toBeCloseTo(100, 10)
  })
})

describe('Perez 1990 and Hay–Davies', () => {
  it('both return exactly DHI on a horizontal plane', () => {
    const flat = clear({ tiltDeg: 0, cosAoi: cosAoi(0, 0, 40, 10) })
    expect(perezSkyDiffuse(flat)).toBeCloseTo(110, 9)
    expect(hayDaviesSkyDiffuse(flat)).toBeCloseTo(110, 9)
  })

  it('under a clear sky both put more diffuse on a sun-facing plane than the isotropic model', () => {
    const iso = (110 * (1 + Math.cos((30 * Math.PI) / 180))) / 2
    expect(perezSkyDiffuse(clear())).toBeGreaterThan(iso)
    expect(hayDaviesSkyDiffuse(clear())).toBeGreaterThan(iso)
  })

  it('zero diffuse in, zero out; sun below the horizon falls back to isotropic', () => {
    expect(perezSkyDiffuse(clear({ dhi: 0 }))).toBe(0)
    const night = clear({ zenithDeg: 95, airmass: relativeAirmass(95), dni: 0, dhi: 10 })
    expect(perezSkyDiffuse(night)).toBeCloseTo((10 * (1 + Math.cos(Math.PI / 6))) / 2, 9)
  })

  it('Perez picks the clearest bin for a clear sky (hand-evaluated from the 1990 coefficient table)', () => {
    // ε = ((110 + 850)/110 + 1.041 z³)/(1 + 1.041 z³), z = 40° → ε ≈ 6.71 → last bin (ε ≥ 6.2)
    // Δ = 110 × AM / 1400; F1 = max(0, 0.678 − 0.327Δ − 0.25z); F2 = 0.156 − 1.377Δ + 0.251z
    const i = clear()
    const z = (40 * Math.PI) / 180
    const delta = (110 * i.airmass) / 1400
    const F1 = Math.max(0, 0.678 - 0.327 * delta - 0.25 * z)
    const F2 = 0.156 - 1.377 * delta + 0.251 * z
    const t = Math.PI / 6
    const expected = 110 * ((1 - F1) * (1 + Math.cos(t)) * 0.5 + (F1 * i.cosAoi) / Math.cos(z) + F2 * Math.sin(t))
    expect(perezSkyDiffuse(i)).toBeCloseTo(expected, 9)
  })
})

describe('ASHRAE IAM', () => {
  it('1 at normal incidence, 0.95 at 60° (b0 = 0.05), 0 at and beyond 90°, never negative', () => {
    expect(ashraeIam(0, 0.05)).toBe(1)
    expect(ashraeIam(60, 0.05)).toBeCloseTo(0.95, 12)
    expect(ashraeIam(88, 0.05)).toBe(0)
    expect(ashraeIam(90, 0.05)).toBe(0)
  })

  it('Brandemuehl–Beckman equivalent angles: 59.7° sky / 90° ground for a flat plane', () => {
    expect(skyDiffuseEquivalentAoi(0)).toBe(59.7)
    expect(groundEquivalentAoi(0)).toBe(90)
    expect(skyDiffuseEquivalentAoi(30)).toBeCloseTo(59.7 - 4.164 + 1.3473, 9)
  })
})
