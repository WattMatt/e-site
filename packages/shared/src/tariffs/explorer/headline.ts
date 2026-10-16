/**
 * The few numbers a reader looks for first: the energy price range, the fixed
 * monthly or daily charges, whether demand is billed, and how much the
 * charges moved since last year. Everything is read from stored charges with
 * their stored units — no conversion beyond c/kWh <-> R/kWh.
 */
import { COMPONENT_LABELS, UNIT_LABELS, formatChargeAmount, formatRandAmount } from '../../solar/tariff/labels'
import { randPerKwh } from '../units'
import type { Charge, ChargeComponent, TariffUnit } from '../types'
import type { ChargeGroupView } from './charge-rows'

export interface HeadlineFixed {
  component: ChargeComponent
  label: string
  text: string
}

export interface TariffHeadline {
  /**
   * The active energy charge across every season, period and block, in c/kWh.
   * Other per-kWh charges (network, ancillary, legacy) are not in it.
   */
  energy: { min: number; max: number } | null
  /** Every charge billed per month or per day, whatever its component, each as one value or a range. */
  fixed: HeadlineFixed[]
  /** True when any charge is billed per kVA, kW or amp: capacity or demand. */
  capacityOrDemand: boolean
}

/** Reading order for the fixed lines; any other component with a fixed unit follows. */
const FIXED_ORDER: readonly ChargeComponent[] = ['basic', 'service', 'admin', 'network_capacity', 'gcc', 'ancillary', 'capacity_amp']
const FIXED_UNITS: readonly TariffUnit[] = ['R_per_month', 'R_per_day', 'R_per_POD_day']
const DEMAND_UNITS: readonly TariffUnit[] = ['R_per_kVA_month', 'R_per_kW_month', 'R_per_A_month']

const cents = (x: number) => Math.round(x * 10000) / 100

export function tariffHeadline(t: { charges: ReadonlyArray<Pick<Charge, 'component' | 'unit' | 'amountExclVat'>> }): TariffHeadline {
  const energy = t.charges.filter((c) => c.component === 'energy' && (c.unit === 'c_per_kWh' || c.unit === 'R_per_kWh')).map((c) => cents(randPerKwh(c)))
  const fixed: HeadlineFixed[] = []
  const withFixed = [...new Set(t.charges.filter((c) => FIXED_UNITS.includes(c.unit)).map((c) => c.component))]
    .sort((a, b) => (FIXED_ORDER.indexOf(a) + 1 || 99) - (FIXED_ORDER.indexOf(b) + 1 || 99))
  for (const component of withFixed) {
    const own = t.charges.filter((c) => c.component === component && FIXED_UNITS.includes(c.unit))
    if (own.length === 0) continue
    // One unit per line: the first one stored. A component stored in two units is rare and its other unit stays in the full list.
    const unit = own[0].unit
    const amounts = own.filter((c) => c.unit === unit).map((c) => c.amountExclVat)
    fixed.push({ component, label: COMPONENT_LABELS[component], text: amountRange(amounts, unit) })
  }
  return {
    energy: energy.length ? { min: Math.min(...energy), max: Math.max(...energy) } : null,
    fixed,
    capacityOrDemand: t.charges.some((c) => DEMAND_UNITS.includes(c.unit)),
  }
}

function amountRange(amounts: number[], unit: TariffUnit): string {
  const lo = Math.min(...amounts)
  const hi = Math.max(...amounts)
  if (lo === hi) return formatChargeAmount(lo, unit)
  return `${formatRandAmount(lo)}–${formatRandAmount(hi)}${UNIT_LABELS[unit].slice(1)}`
}

/** "98.12 c/kWh" or "98.12–312.40 c/kWh". */
export function energyRangeText(e: { min: number; max: number }): string {
  return e.min === e.max ? `${e.min.toFixed(2)} c/kWh` : `${e.min.toFixed(2)}–${e.max.toFixed(2)} c/kWh`
}

export interface YoySummary {
  /** The middle change: one large outlier (a re-based service charge, say) does not drag it. */
  medianPct: number
  minPct: number
  maxPct: number
  /** Charges compared with last year (changed or unchanged). */
  compared: number
  /** Charges with no counterpart last year. */
  added: number
}

/** How the charges moved against last year. Null when there is no previous year to compare with. */
export function summariseYoy(groups: readonly ChargeGroupView[]): YoySummary | null {
  const rows = groups.flatMap((g) => g.rows)
  if (rows.length === 0 || rows.every((r) => r.yoy.kind === 'no_previous')) return null
  const pcts = rows.flatMap((r) => (r.yoy.kind === 'changed' ? [r.yoy.pct] : []))
  const added = rows.filter((r) => r.yoy.kind === 'new').length
  if (pcts.length === 0) return { medianPct: 0, minPct: 0, maxPct: 0, compared: 0, added }
  const sorted = [...pcts].sort((a, b) => a - b)
  const mid = sorted.length >> 1
  return {
    medianPct: sorted.length % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2,
    minPct: Math.min(...pcts),
    maxPct: Math.max(...pcts),
    compared: pcts.length,
    added,
  }
}

/** "+8.7 %", "-1.2 %", "0.0 %". */
export function signedPct(p: number): string {
  const r = Math.round(p * 10) / 10
  return `${r > 0 ? '+' : ''}${(r === 0 ? 0 : r).toFixed(1)} %`
}
