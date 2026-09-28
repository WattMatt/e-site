/**
 * Engine spec §6 validation: an INDEPENDENTLY built reference model of one full case must match
 * NPV / IRR / LCOE to 4 significant figures.
 *
 * The reference is a separate Python model written from the spec formulas (not ported from this
 * TypeScript) — `docs/solar/validation/finance-reference-model.py`. It covers what the 3-year toy
 * in cashflow.test.ts does not: 25 years, the D-07 default escalation path (9 % → 7 % → CPI + 1 %),
 * degradation (2 % + 0.5 %/yr), battery fade with renewal after the year-10 replacement, inverter
 * and battery replacements at CPI, 12B (100 % in year 1, ≤ 1 MW), tax at 27 % with interest
 * deductible and a loss year as a shield (owner Q6), and a 70 % / 11.5 % / 7-year loan.
 * Reference output (python3 finance-reference-model.py, 2026-09-28):
 *   cash NPV 1403612.8873668546  IRR 0.20143789466860118
 *   debt NPV 1525680.5826900909  IRR 0.2983948867984111
 *   LCOE 1.5722388746866387 R/kWh
 */
import { describe, expect, it } from 'vitest'
import { runFinance, type FinanceEnergy, type FinanceInput } from './cashflow'
import { DEFAULT_ESCALATION } from './factors'

const f: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_600_000, inverterZar: 150_000, batteryZar: 450_000, section12bQualifyingZar: 1_150_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 6_000 },
  replacements: { inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: 10, batteryFractionOfCapex: 0.5 },
  tax: { enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 80 },
  degradation: { firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: DEFAULT_ESCALATION, loadGrowth: 0 },
  models: [{ kind: 'cash' }, { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 0 }],
  loadShedding: null,
}
const e: FinanceEnergy = {
  year1PvKwh: 170_000,
  bills: { beforeZar: 900_000, afterPvOnlyZar: 650_000, afterZar: 600_000, exportCreditUsedZar: 0 },
}

const sig4 = (x: number) => Number(x.toPrecision(4))
const rel = (a: number, b: number) => Math.abs(a / b - 1)

describe('25-year case vs the independent reference model (spec §6, 4 s.f.)', () => {
  const r = runFinance(f, e)
  const cash = r.models[0]!.views[0]!
  const debt = r.models[1]!.views[0]!

  it('cash: NPV and IRR', () => {
    expect(sig4(cash.npvZar)).toBe(sig4(1403612.8873668546))
    expect(sig4(cash.irr!)).toBe(sig4(0.20143789466860118))
    expect(rel(cash.npvZar, 1403612.8873668546)).toBeLessThan(1e-9)
  })

  it('debt: NPV and IRR', () => {
    expect(sig4(debt.npvZar)).toBe(sig4(1525680.5826900909))
    expect(sig4(debt.irr!)).toBe(sig4(0.2983948867984111))
    expect(rel(debt.npvZar, 1525680.5826900909)).toBeLessThan(1e-9)
  })

  it('LCOE', () => {
    expect(sig4(r.lcoeZarPerKwh!)).toBe(sig4(1.5722388746866387))
  })

  it('spot rows: year-1 saving, battery-replacement year, inverter-replacement year', () => {
    expect(cash.rows[0]!.savingZar).toBeCloseTo(295_000, 6)
    expect(cash.rows[0]!.netZar).toBeCloseTo(504_680, 6)
    expect(cash.rows[9]!.netZar).toBeCloseTo(19626.72241264046, 4)
    expect(cash.rows[11]!.netZar).toBeCloseTo(270291.5908324309, 4)
  })
})
