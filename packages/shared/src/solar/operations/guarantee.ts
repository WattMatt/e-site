/**
 * Expected generation per month, derived from ONE guarantee basis (spec §10: "auto-derived per month
 * from the case run (no retyping each month)"; WM typed it monthly — defect D.7):
 *   p50              baseline month × (1 − degradation)^(operating year − 1)
 *   pct_of_modelled  pct % of that
 *   manual           the contract's 12 monthly kWh (not degraded: the contract is its own schedule)
 * The commissioning month is prorated by days; a leap February is scaled 29/28 (TMY Feb = 28 days).
 */
import { z } from 'zod'
import type { OpsBaseline } from './baseline'
import { dateMonthKey, daysInMonth, monthParts, monthsBetween, type MonthKey } from './time'

export const GUARANTEE_BASES = ['p50', 'manual', 'pct_of_modelled'] as const
export type GuaranteeBasis = (typeof GUARANTEE_BASES)[number]
export const GUARANTEE_BASIS_LABELS: Record<GuaranteeBasis, string> = {
  p50: 'P50 of the accepted case',
  manual: 'Manual monthly kWh (contract schedule)',
  pct_of_modelled: '% of modelled (P50)',
}
export const TMY_DAYS: readonly number[] = [31, 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31]

export interface Guarantee {
  basis: GuaranteeBasis
  pct: number | null
  manualMonthlyKwh: number[] | null
  degradationPctPerYear: number
}

export const GuaranteeSchema = z.object({
  basis: z.enum(GUARANTEE_BASES),
  pct: z.number().finite().gt(0).max(200).nullable(),
  manualMonthlyKwh: z.array(z.number().finite().min(0)).length(12).nullable(),
  degradationPctPerYear: z.number().finite().min(0).max(5),
}).strict().superRefine((g, ctx) => {
  if ((g.basis === 'pct_of_modelled') !== (g.pct !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['pct'], message: 'A percentage is needed for "% of modelled", and only for it.' })
  }
  if ((g.basis === 'manual') !== (g.manualMonthlyKwh !== null)) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['manualMonthlyKwh'], message: 'Twelve monthly kWh values are needed for "Manual", and only for it.' })
  }
})

export function parseGuarantee(raw: unknown): { ok: true; value: Guarantee } | { ok: false; errors: Record<string, string> } {
  const r = GuaranteeSchema.safeParse(raw)
  if (r.success) return { ok: true, value: r.data }
  const errors: Record<string, string> = {}
  for (const i of r.error.issues) errors[String(i.path[0] ?? 'basis')] ??= i.message
  return { ok: false, errors }
}

const n = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function guaranteeFromRow(row: Record<string, unknown>): Guarantee {
  const manual = row.manual_monthly_kwh
  return {
    basis: row.basis as GuaranteeBasis,
    pct: n(row.pct),
    manualMonthlyKwh: Array.isArray(manual) ? manual.map((v) => Number(v)) : null,
    degradationPctPerYear: n(row.degradation_pct_per_year) ?? 0,
  }
}

/** 1 for the first twelve months from the commissioning month, then 2, … */
export function operatingYear(commissioningDate: string, month: MonthKey): number {
  const m = monthsBetween(dateMonthKey(commissioningDate), month)
  return Math.max(1, Math.floor(m / 12) + 1)
}

/** The baseline's P50 for an ACTUAL calendar month (leap February scaled). */
export function modelledMonthKwh(b: OpsBaseline, month: MonthKey): number {
  const { year, month: m } = monthParts(month)
  return (b.monthlyKwh[m - 1]! * daysInMonth(year, m)) / TMY_DAYS[m - 1]!
}

export interface MonthExpectation {
  /** The whole month's expectation (used to shape per-interval expectations). */
  fullKwh: number
  /** Prorated for the commissioning month. */
  kwh: number
  activeFraction: number
  operatingYear: number
}

export function expectedForMonth(i: { month: MonthKey; guarantee: Guarantee; baseline: OpsBaseline; commissioningDate: string }): MonthExpectation | null {
  const commMonth = dateMonthKey(i.commissioningDate)
  if (monthsBetween(commMonth, i.month) < 0) return null
  const { year, month: m } = monthParts(i.month)
  const year1 = operatingYear(i.commissioningDate, i.month)
  const g = i.guarantee
  const full = g.basis === 'manual'
    ? g.manualMonthlyKwh![m - 1]!
    : modelledMonthKwh(i.baseline, i.month) * (g.basis === 'pct_of_modelled' ? g.pct! / 100 : 1)
      * (1 - g.degradationPctPerYear / 100) ** (year1 - 1)
  const days = daysInMonth(year, m)
  const fraction = i.month === commMonth ? (days - Number(i.commissioningDate.slice(8, 10)) + 1) / days : 1
  return { fullKwh: full, kwh: full * fraction, activeFraction: fraction, operatingYear: year1 }
}
