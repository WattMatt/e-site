/**
 * CaseFinanceConfig + the case + the stored run's size + the STUDY pricing → the engine's FinanceInput
 * (engine spec §6). Tariff escalation and load growth are the study's (resolveStudyPricing: the Tariff
 * tab path and the Load tab growth, I-1); the case config's own escalation and loadGrowthPct fields are
 * legacy and are NOT priced.
 */
import type { FinanceInput, FinanceModel } from '../../services/solar/finance/cashflow'
import type { EscalationPath } from '../../services/solar/finance/factors'
import { SOLAR_ENGINE_DEFAULTS } from '../../services/solar/defaults'
import type { CaseConfig } from './config'
import { capexTotals, type CaseFinanceConfig } from './finance-config'

export const FINANCE_REASONS = {
  noCapex: 'Add capex lines (or apply the org rate card) first.',
  debt: 'Debt-financed: enter the loan share and the interest rate.',
  ppa: 'PPA: enter the starting tariff.',
  lease: 'Lease: enter the monthly payment.',
} as const

const f = (pct: number) => pct / 100

/** The two money inputs Financials takes from the study (ResolvedStudyPricing carries both). */
export interface FinancePricing {
  escalationPath: EscalationPath
  loadGrowthPct: number
}

/**
 * The case inputs Financials prices that the energy run never reads (YF-01): degradation (applied only
 * in the cashflow, engine spec §3.6) and load shedding (valued only in money). build-input does not
 * touch them, so editing them leaves the run — and its hash — alone. Financials therefore takes them
 * from the CURRENT case; everything the energy used (size, battery, …) stays the run's snapshot.
 */
export type FinanceCaseInputs = Pick<CaseConfig, 'degradation' | 'loadShedding'>

export function financeCaseConfig(snapshot: CaseConfig, current: FinanceCaseInputs): CaseConfig {
  return { ...snapshot, degradation: current.degradation, loadShedding: current.loadShedding }
}

/**
 * A comparison key over exactly the priced finance-only values (load-shedding `stage` is read by
 * nothing, YF-05, so it does not count). Accepts raw JSON (a run snapshot's sub-objects); null when
 * they cannot be read, so an unreadable snapshot never claims a change.
 */
export function financeCaseInputsKey(c: { degradation?: unknown; loadShedding?: unknown }): string | null {
  const d = c.degradation as Record<string, unknown> | null | undefined
  const l = c.loadShedding as Record<string, unknown> | null | undefined
  if (!d || typeof d !== 'object' || !l || typeof l !== 'object') return null
  const n = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null)
  return JSON.stringify([n(d.firstYearPct), n(d.annualPct), l.enabled === true, n(l.hoursPerYear), n(l.backedLoadKw)])
}

/** What stops a finance input being built — independent of the study pricing, so callers can name it before reading any tariff. */
export function financeInputReasons(fin: CaseFinanceConfig, size: { dcKwp: number }): string[] {
  const t = capexTotals(fin.capex, size.dcKwp)
  const m = fin.models
  const reasons: string[] = []
  if (!(t.exclVatZar > 0)) reasons.push(FINANCE_REASONS.noCapex)
  if (m.debt.enabled && !(m.debt.loanPct > 0 && m.debt.ratePct > 0)) reasons.push(FINANCE_REASONS.debt)
  if (m.ppa.enabled && !(m.ppa.startTariffZarPerKwh > 0)) reasons.push(FINANCE_REASONS.ppa)
  if (m.lease.enabled && !(m.lease.monthlyPaymentZar > 0)) reasons.push(FINANCE_REASONS.lease)
  return reasons
}

export function buildFinanceInput(
  fin: CaseFinanceConfig, c: CaseConfig, size: { dcKwp: number; acKw: number }, pricing: FinancePricing,
): { ok: true; input: FinanceInput } | { ok: false; reasons: string[] } {
  const t = capexTotals(fin.capex, size.dcKwp)
  const m = fin.models
  const reasons = financeInputReasons(fin, size)
  if (reasons.length > 0) return { ok: false, reasons }

  const models: FinanceModel[] = []
  if (m.cash.enabled) models.push({ kind: 'cash' })
  if (m.debt.enabled) models.push({ kind: 'debt', loanFraction: f(m.debt.loanPct), annualRate: f(m.debt.ratePct), termYears: m.debt.termYears, graceMonths: m.debt.graceMonths })
  if (m.ppa.enabled) models.push({ kind: 'ppa', startTariffZarPerKwh: m.ppa.startTariffZarPerKwh, escalation: f(m.ppa.escalationPct), termYears: m.ppa.termYears,
    buyout: m.ppa.buyoutYear !== null && m.ppa.buyoutPriceZar !== null ? { year: m.ppa.buyoutYear, priceZar: m.ppa.buyoutPriceZar } : null })
  if (m.lease.enabled) models.push({ kind: 'lease', monthlyPaymentZar: m.lease.monthlyPaymentZar, escalation: f(m.lease.escalationPct), termYears: m.lease.termYears, residualZar: m.lease.residualZar })

  const o = fin.opex, a = fin.analysis, d = SOLAR_ENGINE_DEFAULTS.degradation
  const input: FinanceInput = {
    kWpDc: size.dcKwp,
    capex: { totalZar: t.exclVatZar, inverterZar: t.inverterZar, batteryZar: t.batteryZar, section12bQualifyingZar: t.qualifying12bZar },
    opex: {
      omZarPerKwpYear: o.omMode === 'per_kwp' ? o.omZarPerKwpYear : (t.exclVatZar * f(o.omPctOfCapex)) / size.dcKwp,
      insuranceFractionOfCapex: f(o.insurancePctOfCapex),
      monitoringZarPerYear: o.monitoringZarPerYear,
    },
    replacements: {
      inverterYear: o.inverterReplacementYear, inverterFractionOfCapex: f(o.inverterReplacementPct),
      batteryYear: c.battery.enabled ? o.batteryReplacementYear : null, batteryFractionOfCapex: f(o.batteryReplacementPct),
    },
    tax: { enabled: a.taxEnabled, companyRate: f(a.companyTaxRatePct), allowance: a.section12b ? 'section12b' : 'none', systemAcKw: size.acKw },
    degradation: { firstYear: f(c.degradation.firstYearPct), annual: f(c.degradation.annualPct), batteryFadePerYear: d.batteryFadePerYear, batteryEndOfLife: d.batteryEndOfLife },
    analysis: {
      years: a.years, discountRate: f(a.discountRatePct), cpi: f(a.cpiPct), loadGrowth: f(pricing.loadGrowthPct),
      escalation: pricing.escalationPath,
    },
    models,
    loadShedding: c.loadShedding.enabled && fin.loadShedding.valueZarPerKwh !== null
      ? { hoursPerYear: c.loadShedding.hoursPerYear, backedLoadKw: c.loadShedding.backedLoadKw, valueZarPerKwh: fin.loadShedding.valueZarPerKwh }
      : null,
  }
  return { ok: true, input }
}
