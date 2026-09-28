/**
 * Proposal finance options (decision D-15): any of cash / debt / PPA / lease, each computed by the
 * engine. The CLIENT pays the offer price, so the finance input's capex is replaced by the offer
 * (components scaled pro rata) before runStoredFinancials runs on the STORED energy — arithmetic on
 * the stored run, never a re-simulation.
 */
import type { FinanceInput, FinanceModel, FinanceResult, ViewResult } from '../../services/solar/finance/cashflow'
import type { FinanceOptionKind } from './proposal-draft'
import { fixed, pct, zar } from './fmt'

export function proposalFinanceInput(
  base: FinanceInput,
  offerExclVatZar: number,
  kinds: readonly FinanceOptionKind[],
): { ok: true; input: FinanceInput } | { ok: false; missing: FinanceOptionKind[] } {
  const missing = kinds.filter((k) => !base.models.some((m) => m.kind === k))
  if (missing.length) return { ok: false, missing }
  const f = base.capex.totalZar > 0 ? offerExclVatZar / base.capex.totalZar : 1
  const c = base.capex
  return {
    ok: true,
    input: {
      ...base,
      capex: {
        totalZar: offerExclVatZar,
        inverterZar: Math.round(c.inverterZar * f * 100) / 100,
        batteryZar: Math.round(c.batteryZar * f * 100) / 100,
        section12bQualifyingZar: Math.round(c.section12bQualifyingZar * f * 100) / 100,
      },
      models: kinds.map((k) => base.models.find((m) => m.kind === k)!),
    },
  }
}

export interface FinanceOptionSummary {
  kind: FinanceOptionKind
  view: ViewResult['view']
  upfrontZar: number
  year1NetZar: number
  lifetimeNetZar: number
  npvZar: number
  irr: number | null
  simplePaybackYears: number | null
  years: number
  terms: string
}

function termsOf(m: FinanceModel): string {
  switch (m.kind) {
    case 'cash': return 'Paid upfront'
    case 'debt': return `${pct(m.loanFraction, 0)} financed over ${m.termYears} years at ${fixed(m.annualRate * 100, 2)} %`
    case 'ppa': return `R ${fixed(m.startTariffZarPerKwh, 2)}/kWh escalating ${fixed(m.escalation * 100, 1)} %/yr for ${m.termYears} years`
    case 'lease': return `${zar(m.monthlyPaymentZar)}/month escalating ${fixed(m.escalation * 100, 1)} %/yr for ${m.termYears} years`
  }
}

const r2 = (x: number) => Math.round(x * 100) / 100

export function summariseFinanceOptions(result: FinanceResult, models: readonly FinanceModel[]): FinanceOptionSummary[] {
  return models.map((m) => {
    const mr = result.models.find((x) => x.model === m.kind)
    if (!mr) throw new Error(`the finance result has no ${m.kind} model`)
    const v = mr.views.find((x) => x.view === 'client') ?? mr.views.find((x) => x.view === 'owner')
    if (!v) throw new Error(`the ${m.kind} model has no client or owner view`)
    const first = v.rows[0]
    const last = v.rows[v.rows.length - 1]
    return {
      kind: m.kind, view: v.view,
      upfrontZar: r2(v.upfrontZar), year1NetZar: r2(first?.netZar ?? 0), lifetimeNetZar: r2(last?.cumulativeZar ?? 0),
      npvZar: r2(v.npvZar), irr: v.irr, simplePaybackYears: v.simplePaybackYears, years: v.rows.length,
      terms: termsOf(m),
    }
  })
}
