import { describe, expect, it } from 'vitest'
import { runFinance, type FinanceEnergy, type FinanceInput } from './cashflow'
import { DEFAULT_ESCALATION } from './factors'
import { TORNADO_VARIABLES, tornado } from './sensitivity'
import type { Year1Bills } from './bill-calculator'

const f: FinanceInput = {
  kWpDc: 100,
  capex: { totalZar: 1_200_000, inverterZar: 150_000, batteryZar: 0, section12bQualifyingZar: 1_200_000 },
  opex: { omZarPerKwpYear: 150, insuranceFractionOfCapex: 0.005, monitoringZarPerYear: 6_000 },
  replacements: { inverterYear: 12, inverterFractionOfCapex: 0.6, batteryYear: null, batteryFractionOfCapex: 0.5 },
  tax: { enabled: false, companyRate: 0.27, allowance: 'none', systemAcKw: 100 },
  degradation: { firstYear: 0.02, annual: 0.005, batteryFadePerYear: 0.02, batteryEndOfLife: 0.7 },
  analysis: { years: 25, discountRate: 0.11, cpi: 0.05, escalation: DEFAULT_ESCALATION, loadGrowth: 0 },
  models: [{ kind: 'cash' }],
  loadShedding: null,
}
const e: FinanceEnergy = {
  year1PvKwh: 170_000,
  bills: { beforeZar: 900_000, afterZar: 620_000, afterPvOnlyZar: 620_000, exportCreditUsedZar: 40_000 },
}

// A capped re-pricer: the month's energy charges cap the credit at R 45,000 a year, so scaling the
// credit (40,000 x 1.2 = 48,000) would overshoot and the re-priced bill must not.
const CREDIT_CAP = 45_000
const reprice = (k: number): Year1Bills => {
  const credit = Math.min(40_000 * k, CREDIT_CAP)
  return { beforeZar: 900_000, afterZar: 660_000 - credit, afterPvOnlyZar: 660_000 - credit, exportCreditUsedZar: credit }
}

describe('sensitivity tornado', () => {
  const t = tornado(f, e, 0, 'owner', 0.2, { exportRateBills: reprice })

  it('covers the five spec variables, sorted by spread, around the base NPV', () => {
    expect(t.bars.map((b) => b.variable).sort()).toEqual([...TORNADO_VARIABLES].sort())
    for (let i = 1; i < t.bars.length; i++) expect(t.bars[i - 1]!.spreadZar).toBeGreaterThanOrEqual(t.bars[i]!.spreadZar)
    expect(t.baseNpvZar).toBeCloseTo(runFinance(f, e).models[0]!.views[0]!.npvZar, 6)
  })

  it('moves NPV in the right direction for each variable', () => {
    const bar = (v: string) => t.bars.find((b) => b.variable === v)!
    expect(bar('capex').highNpvZar).toBeLessThan(bar('capex').lowNpvZar)
    expect(bar('yield').highNpvZar).toBeGreaterThan(bar('yield').lowNpvZar)
    expect(bar('tariffEscalation').highNpvZar).toBeGreaterThan(bar('tariffEscalation').lowNpvZar)
    expect(bar('discountRate').highNpvZar).toBeLessThan(bar('discountRate').lowNpvZar)
    expect(bar('exportRate').highNpvZar).toBeGreaterThan(bar('exportRate').lowNpvZar)
  })

  it('capex ±20 % moves a cash NPV by exactly ±20 % of capex plus the insurance it carries', () => {
    const bar = t.bars.find((b) => b.variable === 'capex')!
    expect(bar.lowNpvZar - t.baseNpvZar).toBeGreaterThan(0.2 * 1_200_000)
  })

  it('the yield swing scales delivered energy too, so a PPA view moves with it', () => {
    const ppa: FinanceInput = { ...f, models: [{ kind: 'ppa', startTariffZarPerKwh: 1.2, escalation: 0.05, termYears: 25, buyout: null }] }
    const ed: FinanceEnergy = { ...e, year1DeliveredKwh: 150_000 }
    const inv = tornado(ppa, ed, 0, 'investor').bars.find((b) => b.variable === 'yield')!
    const pvBase = runFinance(ppa, ed).models[0]!.views[1]!.npvZar
    const pvHigh = runFinance(ppa, { ...ed, year1PvKwh: e.year1PvKwh * 1.2, year1DeliveredKwh: 150_000 * 1.2 }).models[0]!.views[1]!.npvZar
    expect(inv.highNpvZar).toBeCloseTo(pvHigh, 6)
    expect(inv.highNpvZar).toBeGreaterThan(pvBase)
  })

  it('export rate has no effect when no export credit is used', () => {
    const zero = (): Year1Bills => ({ ...e.bills, exportCreditUsedZar: 0 })
    const t0 = tornado(f, { ...e, bills: zero() }, 0, 'owner', 0.2, { exportRateBills: zero })
    expect(t0.bars.find((b) => b.variable === 'exportRate')!.spreadZar).toBe(0)
  })

  it('the export-rate swing uses the RE-PRICED bills, so the net-billing cap still binds (not credit x k)', () => {
    const bar = t.bars.find((b) => b.variable === 'exportRate')!
    const npv = (b: Year1Bills) => runFinance(f, { ...e, bills: b }).models[0]!.views[0]!.npvZar
    expect(bar.highNpvZar).toBeCloseTo(npv(reprice(1.2)), 6)
    expect(bar.lowNpvZar).toBeCloseTo(npv(reprice(0.8)), 6)
    // Naive scaling would have credited 48,000 > the 45,000 cap and overstated the high NPV.
    const naive = npv({ ...e.bills, afterZar: 620_000 - 8_000, afterPvOnlyZar: 620_000 - 8_000, exportCreditUsedZar: 48_000 })
    expect(bar.highNpvZar).toBeLessThan(naive)
  })

  it('without a re-pricer the export-rate bar is left out and says so, rather than scaling the credit', () => {
    const t2 = tornado(f, e)
    expect(t2.bars.map((b) => b.variable)).not.toContain('exportRate')
    expect(t2.omitted).toEqual(['exportRate'])
    expect(t.omitted).toEqual([])
  })
})
