/**
 * Hourly PV simulation (engine spec §3.4–3.5, §4 KPIs).
 *
 * Per hour the sun is placed at the irradiance SAMPLE instant (SAST hour start + the weather's
 * sampleOffsetH), POA and power are computed there, and the resulting series are then linearly
 * re-centred onto the hour midpoint so `pAc[h]` is the mean over [h, h+1) like every other
 * engine series. Re-centring is circular and weight-preserving, so annual totals are unchanged.
 */
import { solarPosition } from '../solar-position/spa'
import {
  beamOnPlane,
  cosAoi,
  extraterrestrialDni,
  groundReflected,
  hayDaviesSkyDiffuse,
  perezSkyDiffuse,
  relativeAirmass,
} from '../irradiance/transposition'
import { ashraeIam, groundEquivalentAoi, skyDiffuseEquivalentAoi } from '../irradiance/iam'
import { cellTemperature, type CellTempModel } from './cell-temperature'
import { acFactor, combinedDcLoss, type AcLosses, type DcLosses } from './losses'
import { inverterOutput, validateCurve, type InverterSpec } from './inverter'
import { HOURS_PER_YEAR, sastHourStartUtcMs, sum } from '../time'
import type { WeatherYear } from '../weather/reference-year'

export interface ModuleSpec {
  /** Pmax temperature coefficient per °C, e.g. −0.0035. */
  gammaPmaxPerC: number
  /** ASHRAE IAM b0, default 0.05. */
  iamB0: number
}

export interface PvArray {
  id: string
  kWpDc: number
  tiltDeg: number
  /** 0 = north, 90 = east, 180 = south, 270 = west. */
  azimuthDeg: number
  module: ModuleSpec
  cellTemp: CellTempModel
  losses: DcLosses
  inverterId: string
}

export interface PvSystem {
  arrays: PvArray[]
  inverters: InverterSpec[]
  acLosses: AcLosses
  albedo: number
  transposition: 'perez' | 'hay-davies'
}

export interface PvSeries {
  /** AC output after inverter, AC wiring and availability, kW (= kWh in the hour). */
  pAc: Float64Array
  /** DC output after the DC loss chain, kW. */
  pDc: Float64Array
  /** Inverter clipping, kW. */
  clipped: Float64Array
}

export interface PvResult extends PvSeries {
  kWpDc: number
  annual: {
    acKwh: number
    dcKwh: number
    clippedKwh: number
    /** Σ_arrays kWp_a × ΣPOA_a / 1000 — the reference yield denominator of PR, kWh. */
    referenceKwh: number
    specificYield: number
    performanceRatio: number
  }
}

interface SunHour {
  zenith: number
  azimuth: number
  dniExtra: number
  airmass: number
}

/** Solar position at every irradiance sample instant — shared by all arrays of one run. */
export function sunPath(w: WeatherYear): SunHour[] {
  const out: SunHour[] = new Array(HOURS_PER_YEAR)
  const offsetMs = w.sampleOffsetH * 3_600_000
  for (let h = 0; h < HOURS_PER_YEAR; h++) {
    const t = sastHourStartUtcMs(h) + offsetMs
    const p = solarPosition(t, w.latitude, w.longitude, {
      elevationM: w.elevation,
      pressureHpa: w.pressure[h]!,
      temperatureC: w.tAmb[h]!,
    })
    const doy = Math.floor(h / 24) + 1
    out[h] = { zenith: p.zenith, azimuth: p.azimuth, dniExtra: extraterrestrialDni(doy), airmass: relativeAirmass(p.zenith) }
  }
  return out
}

function validate(sys: PvSystem): void {
  if (sys.arrays.length === 0) throw new Error('PV system has no arrays')
  if (!(sys.albedo >= 0 && sys.albedo <= 1)) throw new Error(`albedo must be in [0, 1], got ${sys.albedo}`)
  const ids = new Set(sys.inverters.map((i) => i.id))
  for (const inv of sys.inverters) {
    if (!(inv.acRatedKw > 0)) throw new Error(`inverter ${inv.id}: acRatedKw must be > 0`)
    if (inv.efficiencyCurve) validateCurve(inv.efficiencyCurve)
  }
  for (const a of sys.arrays) {
    if (!(a.kWpDc > 0)) throw new Error(`array ${a.id}: kWpDc must be > 0`)
    if (!(a.tiltDeg >= 0 && a.tiltDeg <= 90)) throw new Error(`array ${a.id}: tilt must be 0–90°`)
    if (!ids.has(a.inverterId)) throw new Error(`array ${a.id}: unknown inverter ${a.inverterId}`)
  }
}

/** Re-centre a series sampled at h + offset onto h + 0.5 (linear, circular). */
export function recentre(sampled: Float64Array, offsetH: number): Float64Array {
  const n = sampled.length
  const out = new Float64Array(n)
  const shift = 0.5 - offsetH
  const k0 = Math.floor(shift)
  const frac = shift - k0
  for (let h = 0; h < n; h++) {
    const a = sampled[(((h + k0) % n) + n) % n]!
    const b = sampled[(((h + k0 + 1) % n) + n) % n]!
    out[h] = (1 - frac) * a + frac * b
  }
  return out
}

export function simulatePv(w: WeatherYear, sys: PvSystem, sun: SunHour[] = sunPath(w)): PvResult {
  validate(sys)
  const dcByInverter = new Map<string, Float64Array>(sys.inverters.map((i) => [i.id, new Float64Array(HOURS_PER_YEAR)]))
  let referenceKwh = 0
  let kWpDc = 0

  for (const a of sys.arrays) {
    kWpDc += a.kWpDc
    const keep = 1 - combinedDcLoss(a.losses)
    const iamSky = ashraeIam(skyDiffuseEquivalentAoi(a.tiltDeg), a.module.iamB0)
    const iamGnd = ashraeIam(groundEquivalentAoi(a.tiltDeg), a.module.iamB0)
    const dc = dcByInverter.get(a.inverterId)!
    let poaSum = 0
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      const s = sun[h]!
      const ca = cosAoi(a.tiltDeg, a.azimuthDeg, s.zenith, s.azimuth)
      const beam = beamOnPlane(w.dni[h]!, ca, s.zenith)
      const skyIn = { tiltDeg: a.tiltDeg, cosAoi: ca, zenithDeg: s.zenith, dni: w.dni[h]!, dhi: w.dhi[h]!, dniExtra: s.dniExtra, airmass: s.airmass }
      const sky = sys.transposition === 'perez' ? perezSkyDiffuse(skyIn) : hayDaviesSkyDiffuse(skyIn)
      const gnd = groundReflected(w.ghi[h]!, sys.albedo, a.tiltDeg)
      const poa = beam + sky + gnd
      if (poa <= 0) continue
      poaSum += poa
      const aoiDeg = (Math.acos(Math.max(-1, Math.min(1, ca))) * 180) / Math.PI
      const poaEff = beam * ashraeIam(aoiDeg, a.module.iamB0) + sky * iamSky + gnd * iamGnd
      const tCell = cellTemperature(a.cellTemp, w.tAmb[h]!, poa, w.wind[h]!)
      const p = a.kWpDc * (poaEff / 1000) * (1 + a.module.gammaPmaxPerC * (tCell - 25)) * keep
      dc[h] += Math.max(0, p)
    }
    referenceKwh += (a.kWpDc * poaSum) / 1000
  }

  const acMult = acFactor(sys.acLosses)
  const pDcS = new Float64Array(HOURS_PER_YEAR)
  const pAcS = new Float64Array(HOURS_PER_YEAR)
  const clipS = new Float64Array(HOURS_PER_YEAR)
  for (const inv of sys.inverters) {
    const dc = dcByInverter.get(inv.id)!
    const invSpec = { ...inv, dcRatedKw: inv.dcRatedKw ?? inv.acRatedKw }
    for (let h = 0; h < HOURS_PER_YEAR; h++) {
      if (dc[h]! <= 0) continue
      const o = inverterOutput(dc[h]!, invSpec)
      pDcS[h] += dc[h]!
      pAcS[h] += o.pAcKw * acMult
      clipS[h] += o.clippedKw
    }
  }

  const pAc = recentre(pAcS, w.sampleOffsetH)
  const pDc = recentre(pDcS, w.sampleOffsetH)
  const clipped = recentre(clipS, w.sampleOffsetH)
  const acKwh = sum(pAc)
  return {
    pAc,
    pDc,
    clipped,
    kWpDc,
    annual: {
      acKwh,
      dcKwh: sum(pDc),
      clippedKwh: sum(clipped),
      referenceKwh,
      specificYield: acKwh / kWpDc,
      performanceRatio: referenceKwh > 0 ? acKwh / referenceKwh : 0,
    },
  }
}
