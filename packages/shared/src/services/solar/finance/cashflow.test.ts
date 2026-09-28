import { describe, expect, it } from 'vitest'
import { allowanceSchedule, runFinance, type FinanceEnergy, type FinanceInput } from './cashflow'
import { DEFAULT_ESCALATION } from './factors'

/**
 * XLSX-independent check (spec §6 validation): a 3-year toy case computed by hand.
 *   capex R100 000, 10 kWp, O&M R150/kWp = R1 500, insurance 0.5 % = R500 (NO ×12, D-05)
 *   CPI 5 %  → opex 2 000 / 2 100 / 2 205
 *   bills before R50 000, after R10 000 → year-1 saving R40 000; tariff +10 % a year (published)
 *   → saving 40 000 / 44 000 / 48 400; no degradation; tax off
 *   net 38 000 / 41 900 / 46 195
 *   NPV @10 % = −100 000 + 38 000/1.1 + 41 900/1.21 + 46 195/1.331
 *             = −100 000 + 34 545.4545 + 34 628.0992 + 34 706.9872 = 3 880.5409
 *   simple payback: −100 000 → −62 000 → −20 100 → +26 095  ⇒ 2 + 20 100/46 195 = 2.435112
 *   discounted: −65 454.5455 → −30 826.4463 → +3 880.5409  ⇒ 2 + 30 826.4463/34 706.9872 = 2.888191
 *   LCOE = (100 000 + 1 818.1818 + 1 735.5372 + 1 656.6491) / (14 545.4545 + 13 223.1405 + 12 021.0368)
 *        = 105 210.3681 / 39 789.6318 = 2.644165 R/kWh
 *   IRR: NPV(0.1212) ≈ 0  →  0.1212 (4 s.f.)
 */
const toy: FinanceInput = {
  kWpDc: 10,
  capex: { totalZar: 100_000, inverterZar: 0, batteryZar: 0, section12bQualifyingZar: 0 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 },
  replacements: { inverterYear: null, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 },
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 10 },
  degradation: { firstYear: 0, annual: 0, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  analysis: { years: 3, discountRate: 0.1, cpi: 0.05, escalation: { ...DEFAULT_ESCALATION, published: [0.1, 0.1] }, loadGrowth: 0 },
  models: [{ kind: 'cash' }],
  loadShedding: null,
}
const toyEnergy: FinanceEnergy = {
  year1PvKwh: 16_000,
  bills: { beforeZar: 50_000, afterZar: 10_000, afterPvOnlyZar: 10_000, exportCreditUsedZar: 0 },
}

const sig4 = (x: number) => Number(x.toPrecision(4))

describe('3-year toy cashflow, matched to hand computation (4 s.f.)', () => {
  const r = runFinance(toy, toyEnergy)
  const v = r.models[0]!.views[0]!

  it('rows', () => {
    expect(v.rows.map((x) => x.savingZar)).toEqual([40_000, 44_000, 48_400].map((x) => expect.closeTo(x, 6)))
    expect(v.rows.map((x) => x.opexZar)).toEqual([2_000, 2_100, 2_205].map((x) => expect.closeTo(x, 6)))
    expect(v.rows.map((x) => x.netZar)).toEqual([38_000, 41_900, 46_195].map((x) => expect.closeTo(x, 6)))
  })

  it('NPV, IRR, paybacks and LCOE', () => {
    expect(sig4(v.npvZar)).toBe(3881)
    expect(v.npvZar).toBeCloseTo(3880.5409, 3)
    expect(sig4(v.irr!)).toBe(0.1212)
    expect(sig4(v.simplePaybackYears!)).toBe(2.435)
    expect(sig4(v.discountedPaybackYears!)).toBe(2.888)
    expect(sig4(r.lcoeZarPerKwh!)).toBe(2.644)
  })
})

describe('insurance (D-05) and degradation (§3.6)', () => {
  it('insurance is capex × 0.5 % a year — R500 in year 1, never R6 000', () => {
    const r = runFinance({ ...toy, opex: { omZarPerKwpYear: 0, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 0 } }, toyEnergy)
    expect(r.models[0]!.views[0]!.rows[0]!.opexZar).toBe(500)
  })

  it('year-1 saving and energy already carry the first-year degradation', () => {
    const r = runFinance({ ...toy, degradation: { ...toy.degradation, firstYear: 0.02, annual: 0.005 } }, toyEnergy)
    const rows = r.models[0]!.views[0]!.rows
    expect(rows[0]!.energyKwh).toBeCloseTo(16_000 * 0.98, 9)
    expect(rows[1]!.savingZar).toBeCloseTo(40_000 * 0.98 * 0.995 * 1.1, 6)
  })

  it('battery share of the saving fades with capacity; the PV share with degradation', () => {
    const e = { ...toyEnergy, bills: { beforeZar: 50_000, afterPvOnlyZar: 20_000, afterZar: 10_000, exportCreditUsedZar: 0 } }
    const r = runFinance({ ...toy, analysis: { ...toy.analysis, escalation: { ...DEFAULT_ESCALATION, published: [0, 0] } } }, e)
    expect(r.models[0]!.views[0]!.rows[2]!.savingZar).toBeCloseTo(30_000 + 10_000 * 0.96, 6)
  })
})

describe('replacements', () => {
  it('inverter at 60 % and battery at 50 % of their capex, in real terms escalated by CPI', () => {
    const f: FinanceInput = {
      ...toy,
      capex: { totalZar: 100_000, inverterZar: 20_000, batteryZar: 30_000, section12bQualifyingZar: 0 },
      replacements: { inverterYear: 2, inverterFractionOfCapex: 0.6, batteryYear: 3, batteryFractionOfCapex: 0.5 },
    }
    const rows = runFinance(f, toyEnergy).models[0]!.views[0]!.rows
    expect(rows[1]!.replacementZar).toBeCloseTo(12_000 * 1.05, 9)
    expect(rows[2]!.replacementZar).toBeCloseTo(15_000 * 1.1025, 9)
  })
})

describe('tax and Section 12B (D-16)', () => {
  it('is off unless enabled — no tax line at all by default', () => {
    expect(runFinance(toy, toyEnergy).models[0]!.views[0]!.rows.every((r) => r.taxZar === 0)).toBe(true)
  })

  it('12B: 100 % in year 1 up to 1 MW, 50/30/20 above, 125 % only when the enhanced option is chosen', () => {
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 1000 })).toEqual([1])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 1001 })).toEqual([0.5, 0.3, 0.2])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'section12b-enhanced', systemAcKw: 500 })).toEqual([1.25])
    expect(allowanceSchedule({ enabled: true, companyRate: 0.27, allowance: 'none', systemAcKw: 500 })).toEqual([])
  })

  it('tax = rate × (saving − opex − allowance); a year-1 allowance makes year-1 tax negative (shield)', () => {
    const f: FinanceInput = {
      ...toy,
      capex: { ...toy.capex, section12bQualifyingZar: 100_000 },
      tax: { enabled: true, companyRate: 0.27, allowance: 'section12b', systemAcKw: 10 },
    }
    const rows = runFinance(f, toyEnergy).models[0]!.views[0]!.rows
    expect(rows[0]!.taxZar).toBeCloseTo(0.27 * (40_000 - 2_000 - 100_000), 6)
    expect(rows[1]!.taxZar).toBeCloseTo(0.27 * (44_000 - 2_100), 6)
  })
})

describe('four finance models side by side (D-15)', () => {
  const f: FinanceInput = {
    ...toy,
    models: [
      { kind: 'cash' },
      { kind: 'debt', loanFraction: 0.5, annualRate: 0.12, termYears: 2, graceMonths: 0 },
      { kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0.05, termYears: 2, buyout: null },
      { kind: 'lease', monthlyPaymentZar: 2_000, escalation: 0, termYears: 2, residualZar: 5_000 },
    ],
  }
  const r = runFinance(f, toyEnergy)

  it('each model produces its own cashflow; PPA and lease show client and investor views', () => {
    expect(r.models.map((m) => [m.model, m.views.map((v) => v.view)])).toEqual([
      ['cash', ['owner']],
      ['debt', ['owner']],
      ['ppa', ['client', 'investor']],
      ['lease', ['client', 'investor']],
    ])
  })

  it('debt: equity upfront, annuity service in the years, interest deductible only when taxed', () => {
    const v = r.models[1]!.views[0]!
    expect(v.upfrontZar).toBe(-50_000)
    const pmt = (50_000 * 0.01) / (1 - 1.01 ** -24)
    expect(v.rows[0]!.financeZar).toBeCloseTo(12 * pmt, 6)
    expect(v.rows[2]!.financeZar).toBe(0)
    expect(v.rows[0]!.netZar).toBeCloseTo(38_000 - 12 * pmt, 6)
  })

  it('PPA client: saving − R1.50/kWh × energy (escalating), then owns the system after the term', () => {
    const c = r.models[2]!.views[0]!
    expect(c.upfrontZar).toBe(0)
    expect(c.rows.map((x) => x.netZar)).toEqual([16_000, 18_800, 46_195].map((x) => expect.closeTo(x, 6)))
    expect(c.irr).toBeNull()
    const inv = r.models[2]!.views[1]!
    expect(inv.upfrontZar).toBe(-100_000)
    expect(inv.rows.map((x) => x.netZar)).toEqual([22_000, 23_100, 0].map((x) => expect.closeTo(x, 6)))
  })

  it('lease client: saving − 12 × monthly payment, residual paid in the final lease year', () => {
    const c = r.models[3]!.views[0]!
    expect(c.rows.map((x) => x.netZar)).toEqual([16_000, 15_000, 46_195].map((x) => expect.closeTo(x, 6)))
    const inv = r.models[3]!.views[1]!
    expect(inv.rows.map((x) => x.netZar)).toEqual([22_000, 26_900, 0].map((x) => expect.closeTo(x, 6)))
  })

  it('PPA bills DELIVERED energy — curtailed kWh (export limit / no export) are never charged', () => {
    const e: FinanceEnergy = { ...toyEnergy, year1DeliveredKwh: 12_000 }
    const p = runFinance({ ...toy, models: [{ kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0, termYears: 3, buyout: null }] }, e)
    expect(p.models[0]!.views[0]!.rows[0]!.financeZar).toBeCloseTo(12_000 * 1.5, 6)
    expect(p.models[0]!.views[1]!.rows[0]!.netZar).toBeCloseTo(12_000 * 1.5 - 2_000, 6)
    // Generation (incl. curtailment) is still what the energy row and LCOE report.
    expect(p.models[0]!.views[0]!.rows[0]!.energyKwh).toBe(16_000)
  })

  it('PPA buy-out ends the service period early', () => {
    const b = runFinance({ ...toy, models: [{ kind: 'ppa', startTariffZarPerKwh: 1.5, escalation: 0, termYears: 3, buyout: { year: 1, priceZar: 70_000 } }] }, toyEnergy)
    const c = b.models[0]!.views[0]!
    expect(c.rows[0]!.netZar).toBeCloseTo(40_000 - 24_000 - 70_000, 6)
    expect(c.rows[1]!.netZar).toBeCloseTo(44_000 - 2_100, 6)
  })
})

describe('load-shedding value (D-14)', () => {
  it('is reported separately and never changes any cashflow, NPV or IRR', () => {
    const withLs = runFinance({ ...toy, loadShedding: { hoursPerYear: 100, backedLoadKw: 10, valueZarPerKwh: 5 } }, toyEnergy)
    const without = runFinance(toy, toyEnergy)
    expect(withLs.loadShedding!.annualZar).toEqual([5_000, 5_250, 5_512.5].map((x) => expect.closeTo(x, 9)))
    expect(withLs.models).toEqual(without.models)
    expect(without.loadShedding).toBeNull()
  })
})

describe('blocking inputs', () => {
  it('a run with no capex is refused with a named reason (no silent R12k/kWp fallback)', () => {
    expect(() => runFinance({ ...toy, capex: { ...toy.capex, totalZar: 0 } }, toyEnergy)).toThrow(/capex must be > 0/)
    expect(() => runFinance({ ...toy, models: [] }, toyEnergy)).toThrow(/at least one finance model/)
    expect(() => runFinance({ ...toy, opex: { ...toy.opex, insuranceFractionOfCapex: 6 } }, toyEnergy)).toThrow(/insuranceFractionOfCapex/)
  })

  it('NaN, negative costs and fractional replacement years are refused, never computed through', () => {
    expect(() => runFinance({ ...toy, analysis: { ...toy.analysis, cpi: Number.NaN } }, toyEnergy)).toThrow(/cpi/)
    expect(() => runFinance({ ...toy, analysis: { ...toy.analysis, loadGrowth: Number.NaN } }, toyEnergy)).toThrow(/loadGrowth/)
    expect(() => runFinance({ ...toy, opex: { ...toy.opex, omZarPerKwpYear: -1 } }, toyEnergy)).toThrow(/omZarPerKwpYear/)
    expect(() => runFinance({ ...toy, kWpDc: Number.NaN }, toyEnergy)).toThrow(/kWpDc/)
    expect(() => runFinance({ ...toy, degradation: { ...toy.degradation, batteryEndOfLife: 1.5 } }, toyEnergy)).toThrow(/battery end-of-life/)
    expect(() => runFinance({ ...toy, replacements: { ...toy.replacements, batteryYear: 7.5 } }, toyEnergy)).toThrow(/batteryYear/)
  })
})
