/** CaseFinanceConfig + the case + the stored run's size → the engine's FinanceInput (engine spec §6). */
import type { FinanceInput, FinanceModel } from '../../services/solar/finance/cashflow'
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

export function buildFinanceInput(
  fin: CaseFinanceConfig, c: CaseConfig, size: { dcKwp: number; acKw: number },
): { ok: true; input: FinanceInput } | { ok: false; reasons: string[] } {
  const t = capexTotals(fin.capex, size.dcKwp)
  const m = fin.models
  const reasons: string[] = []
  if (!(t.exclVatZar > 0)) reasons.push(FINANCE_REASONS.noCapex)
  if (m.debt.enabled && !(m.debt.loanPct > 0 && m.debt.ratePct > 0)) reasons.push(FINANCE_REASONS.debt)
  if (m.ppa.enabled && !(m.ppa.startTariffZarPerKwh > 0)) reasons.push(FINANCE_REASONS.ppa)
  if (m.lease.enabled && !(m.lease.monthlyPaymentZar > 0)) reasons.push(FINANCE_REASONS.lease)
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
      years: a.years, discountRate: f(a.discountRatePct), cpi: f(a.cpiPct), loadGrowth: f(a.loadGrowthPct),
      escalation: { published: [], startRate: f(a.escalationStartPct), endRate: f(a.escalationYear10Pct), linearToYear: 10, cpiMargin: f(a.escalationAfterCpiPlusPct) },
    },
    models,
    loadShedding: c.loadShedding.enabled && fin.loadShedding.valueZarPerKwh !== null
      ? { hoursPerYear: c.loadShedding.hoursPerYear, backedLoadKw: c.loadShedding.backedLoadKw, valueZarPerKwh: fin.loadShedding.valueZarPerKwh }
      : null,
  }
  return { ok: true, input }
}
