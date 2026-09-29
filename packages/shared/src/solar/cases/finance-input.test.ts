import { describe, it, expect } from 'vitest'
import { solarOrgSettingDefaults } from '../org-settings'
import { defaultCaseConfig } from './config'
import { defaultFinanceConfig, type CaseFinanceConfig } from './finance-config'
import { buildFinanceInput, financeCaseConfig, financeCaseInputsKey, FINANCE_REASONS, type FinancePricing } from './finance-input'
import { runFinance } from '../../services/solar/finance/cashflow'
import { DEFAULT_ESCALATION } from '../../services/solar/finance/factors'

const PRICING: FinancePricing = { escalationPath: { ...DEFAULT_ESCALATION, published: [0.12, 0.1] }, loadGrowthPct: 0 }

const s = solarOrgSettingDefaults()
const cfg = defaultCaseConfig(s, { dcKwp: 500, acKw: 400 }, PRICING)
const withCapex = (): CaseFinanceConfig => ({ ...defaultFinanceConfig(s), capex: [
  { id: 'a', category: 'modules', description: 'PV', qty: 500_000, unit: 'Wp', rateZar: 10, qualifies12b: true, source: 'manual' },
  { id: 'b', category: 'inverters', description: 'Inv', qty: 400, unit: 'kW', rateZar: 1500, qualifies12b: true, source: 'manual' },
] })

describe('buildFinanceInput', () => {
  it('converts percentages, sums capex, and defaults to cash only with tax off (D-16) and insurance 0.5 %/yr (D-05)', () => {
    const r = buildFinanceInput(withCapex(), cfg, { dcKwp: 500, acKw: 400 }, PRICING)
    expect(r.ok).toBe(true)
    if (!r.ok) return
    const f = r.input
    expect(f.capex).toEqual({ totalZar: 5_600_000, inverterZar: 600_000, batteryZar: 0, section12bQualifyingZar: 5_600_000 })
    expect(f.opex).toEqual({ omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 })
    expect(f.models).toEqual([{ kind: 'cash' }])
    expect(f.tax).toEqual({ enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 400 })
    expect(f.analysis).toMatchObject({ years: 25, discountRate: 0.11, cpi: 0.05, loadGrowth: 0 })
    expect(f.analysis.escalation).toEqual(PRICING.escalationPath)
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
    } }, cfg, { dcKwp: 500, acKw: 400 }, PRICING)
    expect(r.ok && r.input.models).toEqual([
      { kind: 'cash' },
      { kind: 'debt', loanFraction: 0.7, annualRate: 0.115, termYears: 7, graceMonths: 6 },
      { kind: 'ppa', startTariffZarPerKwh: 1.45, escalation: 0.06, termYears: 20, buyout: { year: 10, priceZar: 2_000_000 } },
      { kind: 'lease', monthlyPaymentZar: 60_000, escalation: 0.05, termYears: 10, residualZar: 100_000 },
    ])
  })

  it('O&M as % of capex is converted to R/kWp/yr on the capex total', () => {
    const fin = withCapex()
    const r = buildFinanceInput({ ...fin, opex: { ...fin.opex, omMode: 'pct_capex', omPctOfCapex: 1 } }, cfg, { dcKwp: 500, acKw: 400 }, PRICING)
    expect(r.ok && r.input.opex.omZarPerKwpYear).toBeCloseTo(5_600_000 * 0.01 / 500, 9)
  })

  it('names what is missing', () => {
    const fin = defaultFinanceConfig(s)
    const r = buildFinanceInput({ ...fin, models: { ...fin.models, debt: { ...fin.models.debt, enabled: true }, ppa: { ...fin.models.ppa, enabled: true }, lease: { ...fin.models.lease, enabled: true } } }, cfg, { dcKwp: 500, acKw: 400 }, PRICING)
    expect(r).toEqual({ ok: false, reasons: [FINANCE_REASONS.noCapex, FINANCE_REASONS.debt, FINANCE_REASONS.ppa, FINANCE_REASONS.lease] })
  })

  it('load-shedding value only when the case enables it AND a R/kWh value is set (D-14, separate line)', () => {
    const c2 = { ...cfg, loadShedding: { enabled: true, stage: 4, hoursPerYear: 600, backedLoadKw: 120 } }
    const fin = { ...withCapex(), loadShedding: { valueZarPerKwh: 8 } }
    const r = buildFinanceInput(fin, c2, { dcKwp: 500, acKw: 400 }, PRICING)
    expect(r.ok && r.input.loadShedding).toEqual({ hoursPerYear: 600, backedLoadKw: 120, valueZarPerKwh: 8 })
  })

  it('(d) escalation and load growth come from the study pricing (Tariff tab / Load tab), never the case’s own fields', () => {
    const fin = withCapex()
    const own = { ...fin, analysis: { ...fin.analysis, escalationStartPct: 30, escalationYear10Pct: 30, loadGrowthPct: 15 } }
    const r = buildFinanceInput(own, cfg, { dcKwp: 500, acKw: 400 }, { escalationPath: PRICING.escalationPath, loadGrowthPct: 3 })
    expect(r.ok).toBe(true)
    if (!r.ok) return
    expect(r.input.analysis.escalation).toBe(PRICING.escalationPath)
    expect(r.input.analysis.loadGrowth).toBeCloseTo(0.03, 12)
    // A changed Tariff-tab escalation row moves NPV.
    const energy = { year1PvKwh: 800_000, bills: { beforeZar: 3_000_000, afterZar: 1_800_000, afterPvOnlyZar: 1_800_000, exportCreditUsedZar: 0 } }
    const other = buildFinanceInput(fin, cfg, { dcKwp: 500, acKw: 400 }, { escalationPath: { ...PRICING.escalationPath, published: [0.12, 0.2] }, loadGrowthPct: 0 })
    const base = buildFinanceInput(fin, cfg, { dcKwp: 500, acKw: 400 }, PRICING)
    if (!other.ok || !base.ok) throw new Error('unreachable')
    const npv = (i: typeof base.input) => runFinance(i, energy).models[0]!.views[0]!.npvZar
    expect(npv(other.input)).toBeGreaterThan(npv(base.input))
  })
})

describe('finance-only case inputs come from the CURRENT case (YF-01)', () => {
  const snapshot = cfg
  const current = { ...cfg, degradation: { firstYearPct: 0.5, annualPct: 0.2 }, loadShedding: { enabled: true, stage: 4, hoursPerYear: 300, backedLoadKw: 20 },
    pv: { ...cfg.pv, dcKwp: 999 } }
  it('takes degradation and load shedding from the current case, everything else from the run', () => {
    const merged = financeCaseConfig(snapshot, current)
    expect(merged.degradation).toEqual(current.degradation)
    expect(merged.loadShedding).toEqual(current.loadShedding)
    expect(merged.pv).toEqual(snapshot.pv) // energy inputs stay the run's
    const r = buildFinanceInput({ ...withCapex(), loadShedding: { valueZarPerKwh: 5 } } as CaseFinanceConfig, merged, { dcKwp: 500, acKw: 400 }, PRICING)
    if (!r.ok) throw new Error('fixture')
    expect(r.input.degradation).toMatchObject({ firstYear: 0.005, annual: 0.002 })
    expect(r.input.loadShedding).toEqual({ hoursPerYear: 300, backedLoadKw: 20, valueZarPerKwh: 5 })
  })
  it('the comparison key moves on a priced value, not on the unpriced stage, and is null for an unreadable snapshot', () => {
    const k = financeCaseInputsKey(snapshot)
    expect(financeCaseInputsKey({ ...snapshot, degradation: { ...snapshot.degradation, firstYearPct: 0.5 } })).not.toBe(k)
    expect(financeCaseInputsKey({ ...snapshot, loadShedding: { ...snapshot.loadShedding, backedLoadKw: 7 } })).not.toBe(k)
    expect(financeCaseInputsKey({ ...snapshot, loadShedding: { ...snapshot.loadShedding, stage: 7 } })).toBe(k)
    expect(financeCaseInputsKey({ degradation: null, loadShedding: undefined })).toBeNull()
  })
})
