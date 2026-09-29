/**
 * Engine validation against PVGIS (engine spec §3.7, D-19): 5 SA sites × 3 orientations,
 * identical loss inputs, ±3 % on specific yield. Plus the two regression guards that prove the
 * test can fail: WM Solar's static curve, and WM's un-shifted UTC weather.
 */
import { describe, expect, it } from 'vitest'
import {
  PVCALC_LONG_TERM_EY,
  PVGIS_TMY_MONTHS_REFERENCE,
  SITES,
  WM_STATIC_SPECIFIC_YIELD,
  loadWeather,
  type OrientationKey,
  type SiteKey,
} from './__fixtures__/pvgis'
import { simulatePv, sunPath, type PvArray, type PvSystem } from './pv/simulate-pv'
import type { WeatherYear } from './weather/reference-year'

const LOSSES = { soiling: 0.02, shading: 0, mismatch: 0.01, dcWiring: 0.015, lid: 0.015, nameplate: 0 }

function arr(id: string, kWp: number, tilt: number, az: number): PvArray {
  return {
    id,
    kWpDc: kWp,
    tiltDeg: tilt,
    azimuthDeg: az,
    module: { gammaPmaxPerC: -0.0035, iamB0: 0.05 },
    cellTemp: { kind: 'noct', noctC: 45 },
    losses: LOSSES,
    inverterId: 'inv',
  }
}

const ORIENTATIONS: Record<OrientationKey, PvArray[]> = {
  n30: [arr('n', 1, 30, 0)],
  n15: [arr('n', 1, 15, 0)],
  ew10: [arr('e', 0.5, 10, 90), arr('w', 0.5, 10, 270)],
}

function system(arrays: PvArray[]): PvSystem {
  return {
    arrays,
    inverters: [{ id: 'inv', acRatedKw: 10 }], // oversized: no clipping, as in PVGIS
    acLosses: { acWiring: 0.01, availability: 0.99 },
    albedo: 0.2,
    transposition: 'perez',
  }
}

const SITE_KEYS = Object.keys(SITES) as SiteKey[]
const ORIENT_KEYS = Object.keys(ORIENTATIONS) as OrientationKey[]

/** Returns every (site, orientation) whose yield is outside ±tol of the reference. */
function failures(
  yieldOf: (site: SiteKey, o: OrientationKey) => number,
  ref: Record<SiteKey, Record<OrientationKey, number>>,
  tol: number,
): string[] {
  const out: string[] = []
  for (const s of SITE_KEYS) {
    for (const o of ORIENT_KEYS) {
      const dev = yieldOf(s, o) / ref[s][o] - 1
      if (Math.abs(dev) > tol) out.push(`${s}/${o} ${(dev * 100).toFixed(2)} %`)
    }
  }
  return out
}

const weathers = Object.fromEntries(SITE_KEYS.map((s) => [s, loadWeather(s)])) as Record<SiteKey, WeatherYear>

const engineYield = (() => {
  const cache = new Map<string, number>()
  return (s: SiteKey, o: OrientationKey) => {
    const k = `${s}/${o}`
    if (!cache.has(k)) cache.set(k, simulatePv(weathers[s], system(ORIENTATIONS[o])).annual.specificYield)
    return cache.get(k)!
  }
})()

describe('PVGIS validation (spec §3.7)', () => {
  it('engine specific yield is within ±3 % of PVGIS on the same TMY months — all 15 cases', () => {
    expect(failures(engineYield, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toEqual([])
  })

  it('and within ±5 % of the PVcalc 2005–2020 long-term E_y (the TMY is one sample of it)', () => {
    expect(failures(engineYield, PVCALC_LONG_TERM_EY, 0.05)).toEqual([])
  })

  it('REGRESSION GUARD: WM Solar\'s static 2,346 kWh/kWp fails every one of the 15 cases', () => {
    const wm = () => WM_STATIC_SPECIFIC_YIELD
    expect(failures(wm, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toHaveLength(15)
    expect(failures(wm, PVCALC_LONG_TERM_EY, 0.03)).toHaveLength(15)
  })

  it('REGRESSION GUARD: weather used in UTC without the +2 h shift (WM\'s bug) fails every case', () => {
    const rot = (a: Float64Array) => Float64Array.from(a, (_, h) => a[(h + 2) % a.length]!)
    const unshifted = (s: SiteKey, o: OrientationKey) => {
      const w = weathers[s]
      const bad: WeatherYear = { ...w, ghi: rot(w.ghi), dni: rot(w.dni), dhi: rot(w.dhi), tAmb: rot(w.tAmb), wind: rot(w.wind), pressure: rot(w.pressure) }
      return simulatePv(bad, system(ORIENTATIONS[o]), sunPath(bad)).annual.specificYield
    }
    expect(failures(unshifted, PVGIS_TMY_MONTHS_REFERENCE, 0.03)).toHaveLength(15)
  })
})
