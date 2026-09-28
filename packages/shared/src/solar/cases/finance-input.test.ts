import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { defaultFinanceConfig, type CaseFinanceConfig } from './finance-config'
import { buildFinanceInput, FINANCE_REASONS } from './finance-input'

const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 500, acKw: 400 })
const withCapex = (): CaseFinanceConfig => ({ ...defaultFinanceConfig(s), capex: [
  { id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 10, qualifies12b: true, source: 'manual' },
  { id: 'b', category: 'inverters', description: 'Inv', qty: 400, unit: 'kW', rateZar: 1500, qualifies12b: true, source: 'manual' },
] })

describe('buildFinanceInput', () => {
  it('converts percentages, sums capex, and defaults to cash only with tax off (D-16) and insurance 0.5 %/yr (D-05)', () => {
    const r = buildFinanceInput(withCapex(), cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = r.input
    expect(f.capex).toEqual({ totalZar: 5_600_000, inverterZar: 600_000, batteryZar: 0, section12bQualifyingZar: 5_600_000 })
    expect(f.opex).toEqual({ omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 })
    expect(f.models).toEqual([{ kind: 'cash' }])
    expect(f.tax).toEqual({ enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 400 })
    expect(f.analysis).toMatchObject({ years: 25, discountRate: 0.11, cpi: 0.05, loadGrowth: 0 })
    expect(f.analysis.escalation).toEqual({ published: [], startRate: 0.09, endRate: 0.07, linearToYear: 10, cpiMargin: 0.01 })
    expect(f.replacements).toEqual({ inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 })
    expect(f.degradation).toMatchObject({ firstYear: 0.02, annual: 0.005 })
    expect(f.loadShedding).toBeNull()
  })

  it('all four models in order, each with its own inputs (D-15)', () => {
    const fin = withCapex()
    const r = buildFinanceInput({ ...fin, models: {
      cash: { enabled: true },
      debt: { enabled: true, loanPct: 70, ratePct: 11.5, termYears: 7, graceMonths: 6 },
      ppa: { enabled: true, startTariffZarPerKwh: 1.45, escalationPct: 6, termYears: 20, buyoutYear: 10, buyoutPriceZar: 2_000_000 },
      lease: { enabled: true, monthlyPaymentZar: 60_000, escalationPct: 5, termYears: 10, residualZar: 100_000 },
    } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.models).toEqual([
      { kind: 'cash' },
      { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 6 },
      { kind: 'ppa', startTariffZarPerKwh: 1.45, escalation: 0.06, termYears: 20, buyout: { year: 10, priceZar: 2_000_000 } },
      { kind: 'lease', monthlyPaymentZar: 60_000, escalation: 0.05, termYears: 10, residualZar: 100_000 },
    ])
  })

  it('O&M as % of capex is converted to R/kWp/yr on the capex total', () => {
    const fin = withCapex()
    const r = buildFinanceInput({ ...fin, opex: { ...fin.opex, omMode: 'pct_capex', omPctOfCapex: 1 } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.opex.omZarPerKwpYear).toBeCloseTo(5_600_000 * 0.01 / 500, 9)
  })

  it('names what is missing', () => {
    const fin = defaultFinanceConfig(s)
    const r = buildFinanceInput({ ...fin, models: { ...fin.models, debt: { ...fin.models.debt, enabled: true }, ppa: { ...fin.models.ppa, enabled: true }, lease: { ...fin.models.lease, enabled: true } } }, cfg, { dcKwp: 500, acKw: 400 })
    expect(r).toEqual({ ok: false, reasons: [FINANCE_REASONS.noCapex, FINANCE_REASONS.debt, FINANCE_REASONS.ppa, FINANCE_REASONS.lease] })
  })

  it('load-shedding value only when the case enables it AND a R/kWh value is set (D-14, separate line)', () => {
    const c2 = { ...cfg, loadShedding: { enabled: true, stage: 4, hoursPerYear: 600, backedLoadKw: 120 } }
    const fin = { ...withCapex(), loadShedding: { valueZarPerKwh: 8 } }
    const r = buildFinanceInput(fin, c2, { dcKwp: 500, acKw: 400 })
    expect(r.ok && r.input.loadShedding).toEqual({ hoursPerYear: 600, backedLoadKw: 120, valueZarPerKwh: 8 })
  })
})
