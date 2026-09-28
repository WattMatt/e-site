/**
 * Annual financial model (engine spec §6; decisions D-05, D-07, D-14, D-15, D-16).
 *
 * Savings scale from year 1 (hourly model + bill engine) by the tariff path and by energy:
 *   PV share of the saving      × degradation factor (spec §3.6 — the ONLY place degradation applies)
 *   battery share of the saving × battery capacity factor (fade to end-of-life, renewed on replacement)
 * Load growth raises Bill_before and Bill_after equally and leaves the saving unchanged
 * (documented conservative approximation: growth would only raise self-consumption).
 * All money is ZAR excl. VAT (D-16).
 */
import type { Year1Bills } from './bill-calculator'
import {
  batteryHealth,
  cpiFactor,
  degradationFactor,
  tariffFactors,
  type EscalationPath,
} from './factors'
import { loanSchedule } from './loan'
import { irr, lcoe, npv, payback } from './metrics'

export interface CapexBreakdown {
  totalZar: number
  inverterZar: number
  batteryZar: number
  /** Cost qualifying for the Section 12B allowance. */
  section12bQualifyingZar: number
}

export interface OpexInputs {
  omZarPerKwpYear: number
  /** Annual fraction of capex — NO ×12 (D-05). */
  insuranceFractionOfCapex: number
  monitoringZarPerYear: number
}

export interface ReplacementInputs {
  inverterYear: number | null
  inverterFractionOfCapex: number
  batteryYear: number | null
  batteryFractionOfCapex: number
}

export type TaxAllowance = 'none' | 'section12b' | 'section12b-enhanced'

export interface TaxInputs {
  enabled: boolean
  companyRate: number
  allowance: TaxAllowance
  /** AC capacity for the 12B size test (≤ 1 MW → 100 % in year 1, else 50/30/20). */
  systemAcKw: number
}

export interface DegradationInputs {
  firstYear: number
  annual: number
  batteryFadePerYear: number
  batteryEndOfLife: number
}

export interface AnalysisInputs {
  years: number
  discountRate: number
  cpi: number
  escalation: EscalationPath
  loadGrowth: number
}

export type FinanceModel =
  | { kind: 'cash' }
  | { kind: 'debt'; loanFraction: number; annualRate: number; termYears: number; graceMonths: number }
  | {
      kind: 'ppa'
      startTariffZarPerKwh: number
      escalation: number
      termYears: number
      buyout: { year: number; priceZar: number } | null
    }
  | { kind: 'lease'; monthlyPaymentZar: number; escalation: number; termYears: number; residualZar: number }

export interface LoadSheddingInputs {
  hoursPerYear: number
  backedLoadKw: number
  valueZarPerKwh: number
}

export interface FinanceInput {
  kWpDc: number
  capex: CapexBreakdown
  opex: OpexInputs
  replacements: ReplacementInputs
  tax: TaxInputs
  degradation: DegradationInputs
  analysis: AnalysisInputs
  models: FinanceModel[]
  loadShedding: LoadSheddingInputs | null
}

export interface FinanceEnergy {
  /** Year-1 AC energy from the hourly model, before degradation, kWh. */
  year1PvKwh: number
  bills: Year1Bills
}

export interface CashflowRow {
  year: number
  energyKwh: number
  billBeforeZar: number
  billAfterZar: number
  savingZar: number
  opexZar: number
  replacementZar: number
  taxZar: number
  /** Debt service, PPA payments (+ buy-out) or lease payments (+ residual) — positive = paid by this party. */
  financeZar: number
  netZar: number
  cumulativeZar: number
}

export interface ViewResult {
  view: 'owner' | 'client' | 'investor'
  upfrontZar: number
  rows: CashflowRow[]
  npvZar: number
  irr: number | null
  simplePaybackYears: number | null
  discountedPaybackYears: number | null
}

export interface ModelResult {
  model: FinanceModel['kind']
  views: ViewResult[]
}

export interface FinanceResult {
  models: ModelResult[]
  /** Discounted LCOE of the system to whoever owns it, ZAR/kWh. */
  lcoeZarPerKwh: number | null
  /** D-14: reported separately, NEVER part of any cashflow or IRR. */
  loadShedding: { annualZar: number[]; npvZar: number } | null
}

/** Section 12B schedule as fractions of the qualifying cost, year 1 first. */
export function allowanceSchedule(tax: TaxInputs): number[] {
  if (tax.allowance === 'none') return []
  if (tax.allowance === 'section12b-enhanced') return [1.25]
  return tax.systemAcKw <= 1000 ? [1] : [0.5, 0.3, 0.2]
}

function assertFraction(name: string, v: number) {
  if (!(v >= 0 && v <= 1)) throw new Error(`${name} must be a fraction in [0, 1], got ${v}`)
}

function validate(f: FinanceInput): void {
  if (!Number.isInteger(f.analysis.years) || f.analysis.years < 1 || f.analysis.years > 50) throw new Error('analysis years must be 1–50')
  if (!(f.analysis.discountRate > -1)) throw new Error('discount rate must be > −100 %')
  if (!(f.capex.totalZar > 0)) throw new Error('capex must be > 0 — a run with no capex is blocked, never defaulted')
  if (f.capex.inverterZar + f.capex.batteryZar > f.capex.totalZar) throw new Error('inverter + battery capex exceed total capex')
  if (f.models.length === 0) throw new Error('select at least one finance model')
  assertFraction('insuranceFractionOfCapex', f.opex.insuranceFractionOfCapex)
  assertFraction('first-year degradation', f.degradation.firstYear)
  assertFraction('annual degradation', f.degradation.annual)
  assertFraction('tax rate', f.tax.companyRate)
  for (const m of f.models) {
    if (m.kind === 'debt') assertFraction('loan fraction', m.loanFraction)
    if ((m.kind === 'ppa' || m.kind === 'lease') && !(m.termYears >= 1)) throw new Error(`${m.kind} term must be ≥ 1 year`)
    if (m.kind === 'ppa' && m.buyout && !(m.buyout.year >= 1 && m.buyout.year <= m.termYears)) {
      throw new Error('PPA buy-out year must fall within the term')
    }
  }
}

interface Common {
  energy: number[]
  saving: number[]
  billBefore: number[]
  opex: number[]
  repl: number[]
  allowance: number[]
}

function common(f: FinanceInput, e: FinanceEnergy): Common {
  const N = f.analysis.years
  const tf = tariffFactors(N, f.analysis.escalation, f.analysis.cpi)
  const sched = allowanceSchedule(f.tax)
  const pvSaving1 = e.bills.beforeZar - e.bills.afterPvOnlyZar
  const battSaving1 = e.bills.afterPvOnlyZar - e.bills.afterZar
  const c: Common = { energy: [], saving: [], billBefore: [], opex: [], repl: [], allowance: [] }
  for (let n = 1; n <= N; n++) {
    const deg = degradationFactor(n, f.degradation.firstYear, f.degradation.annual)
    const health = batteryHealth(n, f.degradation.batteryFadePerYear, f.degradation.batteryEndOfLife, f.replacements.batteryYear)
    const cpi = cpiFactor(n, f.analysis.cpi)
    c.energy.push(e.year1PvKwh * deg)
    c.saving.push((pvSaving1 * deg + battSaving1 * health) * tf[n - 1]!)
    c.billBefore.push(e.bills.beforeZar * tf[n - 1]! * (1 + f.analysis.loadGrowth) ** (n - 1))
    c.opex.push(
      (f.opex.omZarPerKwpYear * f.kWpDc + f.capex.totalZar * f.opex.insuranceFractionOfCapex + f.opex.monitoringZarPerYear) * cpi,
    )
    let r = 0
    if (f.replacements.inverterYear === n) r += f.capex.inverterZar * f.replacements.inverterFractionOfCapex
    if (f.replacements.batteryYear === n) r += f.capex.batteryZar * f.replacements.batteryFractionOfCapex
    c.repl.push(r * cpi)
    c.allowance.push((sched[n - 1] ?? 0) * f.capex.section12bQualifyingZar)
  }
  return c
}

function view(
  kind: ViewResult['view'],
  upfront: number,
  rows: Omit<CashflowRow, 'cumulativeZar'>[],
  rate: number,
): ViewResult {
  let cum = upfront
  const full = rows.map((r) => {
    cum += r.netZar
    return { ...r, cumulativeZar: cum }
  })
  const flows = [upfront, ...rows.map((r) => r.netZar)]
  return {
    view: kind,
    upfrontZar: upfront,
    rows: full,
    npvZar: npv(rate, flows),
    irr: irr(flows),
    simplePaybackYears: payback(flows),
    discountedPaybackYears: payback(flows, rate),
  }
}

export function runFinance(f: FinanceInput, e: FinanceEnergy): FinanceResult {
  validate(f)
  const c = common(f, e)
  const N = f.analysis.years
  const rate = f.analysis.discountRate
  const taxRate = f.tax.enabled ? f.tax.companyRate : 0
  const base = (i: number) => ({
    year: i + 1,
    energyKwh: c.energy[i]!,
    billBeforeZar: c.billBefore[i]!,
    billAfterZar: c.billBefore[i]! - c.saving[i]!,
    savingZar: c.saving[i]!,
  })

  const models: ModelResult[] = f.models.map((m) => {
    if (m.kind === 'cash' || m.kind === 'debt') {
      const loan = m.kind === 'debt' ? f.capex.totalZar * m.loanFraction : 0
      const sched = m.kind === 'debt' ? loanSchedule({ principalZar: loan, annualRate: m.annualRate, termYears: m.termYears, graceMonths: m.graceMonths }, N) : null
      const rows = c.saving.map((_, i) => {
        const interest = sched?.[i]!.interestZar ?? 0
        const service = sched?.[i]!.paymentZar ?? 0
        const tax = taxRate * (c.saving[i]! - c.opex[i]! - c.allowance[i]! - interest)
        return {
          ...base(i),
          opexZar: c.opex[i]!,
          replacementZar: c.repl[i]!,
          taxZar: tax,
          financeZar: service,
          netZar: c.saving[i]! - c.opex[i]! - c.repl[i]! - tax - service,
        }
      })
      return { model: m.kind, views: [view('owner', -(f.capex.totalZar - loan), rows, rate)] }
    }

    // PPA and lease: a service period, then the client owns the system.
    const serviceYears = m.kind === 'ppa' ? (m.buyout ? m.buyout.year : m.termYears) : m.termYears
    const transferPrice = m.kind === 'ppa' ? (m.buyout?.priceZar ?? 0) : m.residualZar
    const payment = (i: number) => {
      if (i + 1 > serviceYears) return 0
      return m.kind === 'ppa'
        ? c.energy[i]! * m.startTariffZarPerKwh * (1 + m.escalation) ** i
        : 12 * m.monthlyPaymentZar * (1 + m.escalation) ** i
    }
    const clientRows = c.saving.map((_, i) => {
      const inService = i + 1 <= serviceYears
      const pay = payment(i) + (i + 1 === serviceYears ? transferPrice : 0)
      const opex = inService ? 0 : c.opex[i]!
      const repl = inService ? 0 : c.repl[i]!
      const tax = taxRate * (c.saving[i]! - payment(i) - opex)
      return { ...base(i), opexZar: opex, replacementZar: repl, taxZar: tax, financeZar: pay, netZar: c.saving[i]! - pay - opex - repl - tax }
    })
    const investorRows = c.saving.map((_, i) => {
      const inService = i + 1 <= serviceYears
      const income = payment(i) + (i + 1 === serviceYears ? transferPrice : 0)
      const opex = inService ? c.opex[i]! : 0
      const repl = inService ? c.repl[i]! : 0
      const tax = inService ? taxRate * (payment(i) - opex - c.allowance[i]!) : 0
      return {
        year: i + 1,
        energyKwh: inService ? c.energy[i]! : 0,
        billBeforeZar: 0,
        billAfterZar: 0,
        savingZar: 0,
        opexZar: opex,
        replacementZar: repl,
        taxZar: tax,
        financeZar: -income,
        netZar: income - opex - repl - tax,
      }
    })
    return { model: m.kind, views: [view('client', 0, clientRows, rate), view('investor', -f.capex.totalZar, investorRows, rate)] }
  })

  const ls = f.loadShedding
  const loadShedding = ls
    ? (() => {
        const annualZar = Array.from({ length: N }, (_, i) => ls.hoursPerYear * ls.backedLoadKw * ls.valueZarPerKwh * cpiFactor(i + 1, f.analysis.cpi))
        return { annualZar, npvZar: npv(rate, [0, ...annualZar]) }
      })()
    : null

  return {
    models,
    lcoeZarPerKwh: lcoe(rate, f.capex.totalZar, c.opex.map((o, i) => o + c.repl[i]!), c.energy),
    loadShedding,
  }
}
