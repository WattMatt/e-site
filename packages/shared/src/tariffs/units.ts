import type { Charge, TariffUnit } from './types'

export type UnitClass =
  | 'per_kwh' | 'per_month' | 'per_day' | 'per_kva_month' | 'per_kw_month' | 'per_amp_month' | 'per_kvarh' | 'pct'

const CLASS: Record<TariffUnit, UnitClass> = {
  c_per_kWh: 'per_kwh',
  R_per_kWh: 'per_kwh',
  R_per_month: 'per_month',
  R_per_day: 'per_day',
  R_per_POD_day: 'per_day',
  R_per_kVA_month: 'per_kva_month',
  R_per_kW_month: 'per_kw_month',
  R_per_A_month: 'per_amp_month',
  c_per_kVArh: 'per_kvarh',
  pct: 'pct',
}

export function unitClass(u: TariffUnit): UnitClass {
  return CLASS[u]
}

/** Plausible energy prices (as-is/09 §7.1 Stage C.3). */
export const ENERGY_CENTS_RANGE = { min: 50, max: 1500 } as const
export const ENERGY_RAND_RANGE = { min: 0.5, max: 15 } as const

/** R per kWh for a per-kWh charge. Throws for any other unit: the engine never guesses. */
export function randPerKwh(c: Pick<Charge, 'unit' | 'amountExclVat'>): number {
  if (c.unit === 'c_per_kWh') return c.amountExclVat / 100
  if (c.unit === 'R_per_kWh') return c.amountExclVat
  throw new TypeError(`randPerKwh: ${c.unit} is not a per-kWh unit`)
}

export function randPerKvarh(c: Pick<Charge, 'unit' | 'amountExclVat'>): number {
  if (c.unit === 'c_per_kVArh') return c.amountExclVat / 100
  throw new TypeError(`randPerKvarh: ${c.unit} is not a per-kVArh unit`)
}

/**
 * Reads a unit written in a source cell, label or header. Returns null when
 * the text names no unit — never a default. `randPrefix`: the value was written
 * "R1,6464/kWh", so a bare "/kWh" is rand. `bare`: the text is the tail of a
 * value ("R157.91kVA"), so a bare "kVA" or "kW" is a unit.
 */
export function parseUnitToken(
  text: string | null | undefined,
  opts: { randPrefix?: boolean; bare?: boolean } = {},
): TariffUnit | null {
  if (!text) return null
  const t = text.toLowerCase().replace(/\s+/g, '').replace(/\/{2,}/g, '/')
  if (/(c|cents?)\/kvarh|r\.cents\/kvarh/.test(t)) return 'c_per_kVArh'
  // No such units: rand per kVArh, and per kVA per day. Never let "/kva" or "/day" below claim them.
  if (/kvarh/.test(t) || /\/kva\/day/.test(t)) return null
  if (/c\/kwh|cents?\/kwh|c\/unit/.test(t)) return 'c_per_kWh'
  if (/r\/kwh|rand\/kwh/.test(t)) return 'R_per_kWh'
  if (/\/kwh/.test(t)) return opts.randPrefix ? 'R_per_kWh' : null
  if (/\/pod\/day/.test(t)) return 'R_per_POD_day'
  if (/\/day|perday|^day$/.test(t)) return 'R_per_day'
  if (/\/kva|kva\/|r\/?kva/.test(t) || (opts.bare && /^a?\/?kva/.test(t))) return 'R_per_kVA_month'
  if (/\/kw(?!h)|r\/?kw(?!h)/.test(t) || (opts.bare && /^kw$/.test(t))) return 'R_per_kW_month'
  if (/\/amp|\/a\/m|r\/a$|peramp/.test(t) || (opts.bare && /^amps?$/.test(t))) return 'R_per_A_month'
  if (/\/month|permonth|r\/m$|\/m$|^month$|^pm$/.test(t)) return 'R_per_month'
  if (/%$/.test(t)) return 'pct'
  return null
}

export interface UnitDecision {
  unit: TariffUnit | null
  inferred: boolean
  reason: string | null
}

/**
 * The ONLY place a magnitude may change a unit, and only for energy rates.
 * Every change is flagged so a reviewer sees it (unit_inferred + reason).
 */
export function decideEnergyUnit(value: number, labelled: 'c_per_kWh' | 'R_per_kWh' | null): UnitDecision {
  if (labelled === 'c_per_kWh') {
    if (value > 0 && value < 20) {
      return { unit: 'R_per_kWh', inferred: true, reason: `magnitude: labelled c/kWh but ${value} < 20, read as R/kWh` }
    }
    return { unit: 'c_per_kWh', inferred: false, reason: null }
  }
  if (labelled === 'R_per_kWh') {
    if (value >= 50) {
      return { unit: 'c_per_kWh', inferred: true, reason: `magnitude: labelled R/kWh but ${value} >= 50, read as c/kWh` }
    }
    return { unit: 'R_per_kWh', inferred: false, reason: null }
  }
  if (value === 0) return { unit: 'c_per_kWh', inferred: true, reason: 'unitless zero rate' }
  if (value >= ENERGY_RAND_RANGE.min && value <= ENERGY_RAND_RANGE.max) {
    return { unit: 'R_per_kWh', inferred: true, reason: `magnitude: unitless ${value} in 0.5-15, read as R/kWh` }
  }
  if (value >= ENERGY_CENTS_RANGE.min && value <= ENERGY_CENTS_RANGE.max) {
    return { unit: 'c_per_kWh', inferred: true, reason: `magnitude: unitless ${value} in 50-1500, read as c/kWh` }
  }
  return { unit: null, inferred: false, reason: `unitless ${value} is outside both plausible energy ranges` }
}
