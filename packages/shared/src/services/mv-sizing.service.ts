/**
 * mv-sizing.service.ts — equipment sizing checks fed by the computed fault level.
 * Breaker breaking-capacity and adiabatic (I²t) withstand. Pure TS.
 */
export interface SizingVerdict {
  pass: boolean
  note: string
  marginPct?: number
  permissibleTimeS?: number
}

/** Breaker breaking capacity must meet or exceed the prospective Ik3 max. */
export function breakerBreakingCapacityCheck(deviceKa: number, ik3MaxKa: number): SizingVerdict {
  const pass = deviceKa >= ik3MaxKa
  return {
    pass,
    marginPct: ((deviceKa - ik3MaxKa) / ik3MaxKa) * 100,
    note: pass ? 'Breaking capacity adequate' : 'Breaking capacity EXCEEDED — re-rate device',
  }
}

/** Rated making (peak) capacity must meet or exceed the prospective peak ip. */
export function makingCapacityCheck(deviceMakingKaPeak: number, ipKa: number): SizingVerdict {
  const pass = deviceMakingKaPeak >= ipKa
  return {
    pass,
    marginPct: ((deviceMakingKaPeak - ipKa) / ipKa) * 100,
    note: pass ? 'Making capacity adequate' : 'Making capacity EXCEEDED — peak make exceeds device rating',
  }
}

/** Standard short-circuit DC time constant per IEC 62271-100 (45 ms). */
export const IEC_STD_TAU_S = 0.045

/**
 * Asymmetrical (DC-component) breaking duty per IEC 62271-100. At contact
 * separation t the DC fraction is e^(-t/τ) with τ = (X/R)/(2πf). When the
 * network X/R exceeds the standard (τ = 45 ms ⇒ X/R ≈ 14.1 at 50 Hz) the DC
 * component exceeds the breaker's standard rating and its asymmetrical
 * capability must be verified. Reports I_asym = Ik·√(1 + 2·DC²).
 */
export function asymmetricalBreakingCheck(p: {
  ik3MaxKa: number
  xr: number
  contactSeparationS?: number
  freqHz?: number
}): SizingVerdict {
  const f = p.freqHz ?? 50
  const tSep = p.contactSeparationS ?? 0.05
  const tau = p.xr / (2 * Math.PI * f)
  const dc = Math.exp(-tSep / tau)
  const iAsymKa = p.ik3MaxKa * Math.sqrt(1 + 2 * dc * dc)
  const xrStd = 2 * Math.PI * f * IEC_STD_TAU_S
  const pass = p.xr <= xrStd
  return {
    pass,
    marginPct: ((xrStd - p.xr) / xrStd) * 100,
    note: pass
      ? `DC within IEC standard (X/R <= ${xrStd.toFixed(0)}); I_asym ~ ${iAsymKa.toFixed(1)} kA`
      : `X/R ${p.xr.toFixed(1)} > IEC std ${xrStd.toFixed(0)} — DC ${(dc * 100).toFixed(0)}% at ${(tSep * 1000).toFixed(0)} ms; I_asym ~ ${iAsymKa.toFixed(1)} kA, verify breaker asym rating`,
  }
}

/** Standard adiabatic k-factors (A·√s/mm²), IEC 60364-5-54 / IEC 60949. */
export const K_FACTORS = {
  'Cu/XLPE': 143, // copper, XLPE/EPR (90→250 °C)
  'Cu/PVC': 115, // copper, PVC (70→160 °C)
  'Al/XLPE': 94, // aluminium, XLPE/EPR
  'Al/PVC': 76, // aluminium, PVC
} as const

/** The adiabatic short-circuit formula is valid up to ~5 s (IEC 60949). */
export const ADIABATIC_MAX_TIME_S = 5

/**
 * Adiabatic withstand: I²t ≤ k²S² ⇒ permissible time t = (k·S / I)².
 * Flags clearing times outside the adiabatic regime (> ADIABATIC_MAX_TIME_S),
 * where heat dissipation matters and the simple formula no longer applies.
 */
export function adiabaticWithstand(p: {
  kFactor: number
  csaMm2: number
  ikKa: number
  clearTimeS: number
}): SizingVerdict {
  const I = p.ikKa * 1000
  const permissibleTimeS = Math.pow((p.kFactor * p.csaMm2) / I, 2)
  const pass = p.clearTimeS <= permissibleTimeS
  const note = !pass
    ? 'I²t withstand EXCEEDED — increase CSA or clear faster'
    : p.clearTimeS > ADIABATIC_MAX_TIME_S
      ? `Withstand adequate (adiabatic) — but clear time > ${ADIABATIC_MAX_TIME_S} s is outside the adiabatic regime; verify per IEC 60949`
      : 'Withstand adequate'
  return { pass, permissibleTimeS, note }
}
