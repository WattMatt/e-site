import { describe, it, expect } from 'vitest'
import type { FinanceInput, FinanceResult } from '../../services/solar/finance/cashflow'
import { proposalFinanceInput, summariseFinanceOptions } from './finance-options'

const base = {
  kWpDc: 500,
  capex: { totalZar: 1_000_000, inverterZar: 200_000, batteryZar: 0, section12bQualifyingZar: 800_000 },
  models: [
    { kind: 'cash' },
    { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 0 },
    { kind: 'ppa', startTariffZarPerKwh: 1.45, escalation: 0.06, termYears: 20, buyout: null },
  ],
} as unknown as FinanceInput

const row = (year: number, net: number, cum: number) => ({ year, energyKwh: 1, billBeforeZar: 0, billAfterZar: 0, savingZar: net + 10, opexZar: 10, replacementZar: 0, taxZar: 0, financeZar: 0, netZar: net, cumulativeZar: cum })
const result = {
  lcoeZarPerKwh: 0.9, loadShedding: null,
  models: [
    { model: 'cash', views: [{ view: 'owner', upfrontZar: 1_150_000, npvZar: 2_000_000, irr: 0.2, simplePaybackYears: 4.6, discountedPaybackYears: 6, rows: [row(1, 250_000, -900_000), row(2, 260_000, 3_100_000)] }] },
    { model: 'ppa', views: [
      { view: 'client', upfrontZar: 0, npvZar: 500_000, irr: null, simplePaybackYears: null, discountedPaybackYears: null, rows: [row(1, 60_000, 60_000), row(2, 65_000, 900_000)] },
      { view: 'investor', upfrontZar: 1_150_000, npvZar: 100_000, irr: 0.13, simplePaybackYears: 8, discountedPaybackYears: 11, rows: [row(1, 1, 1)] },
    ] },
  ],
} as unknown as FinanceResult

describe('proposalFinanceInput', () => {
  it('prices the capex at the offer (components scaled) and keeps only the offered models, in order', () => {
    const r = proposalFinanceInput(base, 1_150_000, ['ppa', 'cash'])
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.capex).toEqual({ totalZar: 1_150_000, inverterZar: 230_000, batteryZar: 0, section12bQualifyingZar: 920_000 })
    expect(r.input.models.map((m) => m.kind)).toEqual(['ppa', 'cash'])
    expect(base.capex.totalZar).toBe(1_000_000) // input not mutated
  })
  it('names offered models that have no inputs on the case', () => {
    expect(proposalFinanceInput(base, 1_150_000, ['cash', 'lease'])).toEqual({ ok: false, missing: ['lease'] })
  })
})

describe('summariseFinanceOptions', () => {
  it('uses the CLIENT view where one exists, otherwise the owner view; never the investor view', () => {
    const s = summariseFinanceOptions(result, [base.models[0]!, base.models[2]!])
    expect(s.map((x) => [x.kind, x.view])).toEqual([['cash', 'owner'], ['ppa', 'client']])
    expect(s[0]).toMatchObject({ upfrontZar: 1_150_000, year1NetZar: 250_000, lifetimeNetZar: 3_100_000, npvZar: 2_000_000, irr: 0.2, simplePaybackYears: 4.6, years: 2, terms: 'Paid upfront' })
    expect(s[1]).toMatchObject({ upfrontZar: 0, year1NetZar: 60_000, irr: null, terms: 'R 1.45/kWh escalating 6.0 %/yr for 20 years' })
  })
  it('describes debt terms', () => {
    const r = { ...result, models: [{ model: 'debt', views: [{ ...result.models[0]!.views[0]!, view: 'owner' }] }] } as unknown as FinanceResult
    expect(summariseFinanceOptions(r, [base.models[1]!])[0]!.terms).toBe('70 % financed over 7 years at 11.50 %')
  })
})
