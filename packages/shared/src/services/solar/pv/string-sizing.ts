/**
 * String sizing per inverter MPPT (engine spec §3.3):
 *   Voc_cold = Voc_STC × (1 + β_Voc × (T_min − 25)) × n        ≤ V_dc_max       hard fail
 *   Vmp_hot  = Vmp_STC × (1 + γ_Vmp × (T_cell_max − 25)) × n    ≥ V_mppt_min     fail
 *   Vmp_cold = Vmp_STC × (1 + γ_Vmp × (T_min − 25)) × n         ≤ V_mppt_max     warn
 *   strings_parallel × Isc_STC × 1.25                           ≤ I_mppt_max     fail
 * T_cell_max = T_amb,max + 35 °C (racked) / + 45 °C (flush).
 */

export interface StringModuleSpec {
  vocStc: number
  vmpStc: number
  iscStc: number
  /** Voc temperature coefficient, fraction per °C (negative), e.g. −0.0027. */
  betaVocPerC: number
  /** Vmp temperature coefficient, fraction per °C (negative), e.g. −0.0035. */
  gammaVmpPerC: number
}

export interface MpptSpec {
  vDcMax: number
  vMpptMin: number
  vMpptMax: number
  iMpptMax: number
}

export type Mounting = 'racked' | 'flush'

export interface StringSizingInput {
  module: StringModuleSpec
  mppt: MpptSpec
  modulesInSeries: number
  stringsInParallel: number
  tMinC: number
  tAmbMaxC: number
  mounting: Mounting
}

export type CheckStatus = 'pass' | 'warn' | 'fail'

export interface StringCheck {
  id: 'voc-cold' | 'vmp-hot' | 'vmp-cold' | 'current'
  value: number
  limit: number
  status: CheckStatus
}

export interface StringSizingResult {
  vocCold: number
  vmpHot: number
  vmpCold: number
  current: number
  checks: StringCheck[]
  /** No check failed (warnings allowed). */
  ok: boolean
}

/** Default site minimum ambient when no weather is loaded (spec §3.3). */
export const DEFAULT_T_MIN_C = { inland: -5, coastal: 0 } as const

export function cellTempMax(tAmbMaxC: number, mounting: Mounting): number {
  return tAmbMaxC + (mounting === 'racked' ? 35 : 45)
}

export function checkStringSizing(i: StringSizingInput): StringSizingResult {
  if (!Number.isInteger(i.modulesInSeries) || i.modulesInSeries < 1) throw new Error('modulesInSeries must be a positive integer')
  if (!Number.isInteger(i.stringsInParallel) || i.stringsInParallel < 1) throw new Error('stringsInParallel must be a positive integer')
  const n = i.modulesInSeries
  const tHot = cellTempMax(i.tAmbMaxC, i.mounting)
  const vocCold = i.module.vocStc * (1 + i.module.betaVocPerC * (i.tMinC - 25)) * n
  const vmpHot = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (tHot - 25)) * n
  const vmpCold = i.module.vmpStc * (1 + i.module.gammaVmpPerC * (i.tMinC - 25)) * n
  const current = i.stringsInParallel * i.module.iscStc * 1.25
  const checks: StringCheck[] = [
    { id: 'voc-cold', value: vocCold, limit: i.mppt.vDcMax, status: vocCold <= i.mppt.vDcMax ? 'pass' : 'fail' },
    { id: 'vmp-hot', value: vmpHot, limit: i.mppt.vMpptMin, status: vmpHot >= i.mppt.vMpptMin ? 'pass' : 'fail' },
    { id: 'vmp-cold', value: vmpCold, limit: i.mppt.vMpptMax, status: vmpCold <= i.mppt.vMpptMax ? 'pass' : 'warn' },
    { id: 'current', value: current, limit: i.mppt.iMpptMax, status: current <= i.mppt.iMpptMax ? 'pass' : 'fail' },
  ]
  return { vocCold, vmpHot, vmpCold, current, checks, ok: checks.every((c) => c.status !== 'fail') }
}

/** Largest modules-in-series that passes every hard check, or null if none does (spec §3.3). */
export function recommendedModulesInSeries(i: Omit<StringSizingInput, 'modulesInSeries'>, maxN = 200): number | null {
  for (let n = maxN; n >= 1; n--) {
    if (checkStringSizing({ ...i, modulesInSeries: n }).ok) return n
  }
  return null
}
