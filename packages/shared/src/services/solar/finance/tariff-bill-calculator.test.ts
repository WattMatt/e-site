import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff } from '../../../tariffs/types'
import { costHourly } from '../../../tariffs/bill-calculator'
import { netBillingRule } from '../../../tariffs/net-billing-rules'
import type { TouCalendar } from '../../../tariffs/tou'
import type { SubHourlyLoad } from '../energy/max-demand'
import { referenceYearHolidays, tariffBillCalculator, toSubHourlyKwh } from './tariff-bill-calculator'
import { dayTypeOf, referenceYearDates } from '../load/calendar'
import { caseLoadFromSiteSeries } from '../load/case-load'

// Every hour off-peak; hand arithmetic only.
const CAL: TouCalendar = { highSeasonMonths: [6, 7, 8], windows: [], holidayTreatedAs: null, source: 'assumed_eskom' }
const N = 8760

describe('toSubHourlyKwh (4a SubHourlyLoad → 2a SubHourlyKwh)', () => {
  it('converts average kW per interval into kWh per interval and renames the interval field', () => {
    const sub: SubHourlyLoad = { intervalMin: 30, kw: Float64Array.from({ length: N * 2 }, (_, i) => (i === 7 ? 120 : 40)) }
    const out = toSubHourlyKwh(sub)
    expect(out.intervalMinutes).toBe(30)
    expect(out.kwh).toHaveLength(N * 2)
    expect(out.kwh[0]).toBe(20)
    expect(out.kwh[7]).toBe(60)
  })

  it('refuses a series of the wrong length rather than letting the bill engine fall back to hourly demand', () => {
    expect(() => toSubHourlyKwh({ intervalMin: 15, kw: new Float64Array(N) })).toThrow(/35040/)
  })
})

describe('referenceYearHolidays', () => {
  it('lists the 2025 SA public holidays as the YYYY-MM-DD keys the TOU calendar reads (literal list, not re-derived)', () => {
    expect([...referenceYearHolidays(2025)].sort()).toEqual([
      '2025-01-01', '2025-03-21', '2025-04-18', '2025-04-21', '2025-04-27', '2025-04-28', '2025-05-01',
      '2025-06-16', '2025-08-09', '2025-09-24', '2025-12-16', '2025-12-25', '2025-12-26',
    ])
  })
})

describe('tariffBillCalculator (tariff bill engine → finance BillCalculator)', () => {
  const tariff = makeTariff({ name: 'flat SSEG', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
    makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 }),
    makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
  ] })
  const importKwh = new Float64Array(N).fill(1)
  const exportKwh = Float64Array.from({ length: N }, (_, h) => (h % 24 === 12 ? 2 : 0))

  it('returns twelve summaries equal to the bill engine priced directly', () => {
    const sseg = netBillingRule('municipal', { touExport: false })
    const calc = tariffBillCalculator(tariff, { calendar: CAL, referenceYear: 2025, sseg })
    const out = calc.monthlyBills({ importKwh, exportKwh })
    const direct = costHourly(tariff, { importKwh, exportKwh }, { calendar: CAL, year: 2025, sseg, holidays: referenceYearHolidays(2025) })
    expect(out).toHaveLength(12)
    expect(out.map((b) => b.totalZar)).toEqual(direct.map((b) => b.totalExclVat))
    expect(out.map((b) => b.exportCreditUsedZar)).toEqual(direct.map((b) => b.credit.used))
    expect(out[0]).toEqual({ month: 1, totalZar: 1488 + 100 - 62, exportCreditUsedZar: 62 })
  })

  it('carries the sub-hourly import through, so maximum demand comes from the 30-minute peak, not the hourly average', () => {
    const demandTariff = makeTariff({ name: 'demand', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 1 }),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 10, demandBasis: 'actual_md' }),
    ] })
    // 40 kW flat, one 30-minute interval of 120 kW on 1 Jan: hourly average 80 kW, MD 120 kVA.
    const kw = Float64Array.from({ length: N * 2 }, (_, i) => (i === 7 ? 120 : 40))
    const hourly = Float64Array.from({ length: N }, (_, h) => (kw[2 * h]! + kw[2 * h + 1]!) / 2)
    const zero = new Float64Array(N)
    const calc = tariffBillCalculator(demandTariff, { calendar: CAL, referenceYear: 2025 })
    const withSub = calc.monthlyBills({ importKwh: hourly, exportKwh: zero, subHourlyImport: { intervalMin: 30, kw } })
    const hourlyOnly = calc.monthlyBills({ importKwh: hourly, exportKwh: zero })
    const janEnergy = 31 * 24 * 40 + 40 // the spike adds 80 kW x 0.5 h = 40 kWh
    expect(withSub[0]!.totalZar).toBeCloseTo(janEnergy + 120 * 10, 6)
    expect(hourlyOnly[0]!.totalZar).toBeCloseTo(janEnergy + 80 * 10, 6)
  })
})

describe('reference year: the load and the tariff must share day types', () => {
  // One weekday peak hour (07:00-08:00); everything else off-peak. Holidays price as Sunday.
  const CAL_W: TouCalendar = {
    highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'assumed_eskom',
    windows: (['high', 'low'] as const).map((season) => ({ season, dayType: 'weekday' as const, startMinute: 420, endMinute: 480, period: 'peak' as const })),
  }
  const touTariff = makeTariff({ name: 'tou', structure: 'tou', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3, tou: 'peak' }),
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3, tou: 'standard' }),
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 1, tou: 'off_peak' }),
  ] })
  // 1 kWh at 07:00 on every 2025 working weekday (the 3a load calendar decides which days).
  const series = new Float64Array(N)
  referenceYearDates(2025).forEach((d, i) => { if (dayTypeOf(d) === 'weekday') series[i * 24 + 7] = 1 })
  const site = caseLoadFromSiteSeries({ series, referenceYear: 2025 })
  const zero = new Float64Array(N)

  it('prices on the load\'s own year: January 2025 has 22 working weekdays (1 Jan is a holiday) -> 22 kWh x R3', () => {
    const jan = tariffBillCalculator(touTariff, { calendar: CAL_W, referenceYear: site.referenceYear }).monthlyBills({ importKwh: site.load, exportKwh: zero })[0]!
    expect(jan.totalZar).toBe(66)
  })

  it('a one-year slip moves the five January 2025 Fridays onto 2026 Saturdays and misprices silently (17 x R3 + 5 x R1)', () => {
    const jan = tariffBillCalculator(touTariff, { calendar: CAL_W, referenceYear: site.referenceYear + 1 }).monthlyBills({ importKwh: site.load, exportKwh: zero })[0]!
    expect(jan.totalZar).toBe(56)
  })
})

describe('withExportRateScaled: the export-rate sensitivity re-prices through the net-billing rules', () => {
  const tariff = makeTariff({ name: 'flat SSEG', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
    makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
  ] })
  const scaled = (k: number) => makeTariff({ name: 'flat SSEG', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
    makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 * k }),
  ] })
  // Energy-only cap, carry within the municipal FY (ends June). January: 744 kWh x R2 = R1,488 of
  // energy; 1,240 kWh exported (40 kWh at noon every day) earns R1,240 at k = 1 — under the cap —
  // but R1,860 at k = 1.5, which naive scaling of the credit USED would have credited in full.
  const sseg = { ...netBillingRule('municipal', { touExport: false }), capRule: 'energy_charges' as const }
  const importKwh = new Float64Array(N).fill(1)
  const exportKwh = Float64Array.from({ length: N }, (_, h) => (h < 744 && h % 24 === 12 ? 40 : 0))
  const calc = tariffBillCalculator(tariff, { calendar: CAL, referenceYear: 2025, sseg })

  it('k = 1: January uses its R1,240 credit in full (under the R1,488 cap)', () => {
    expect(calc.monthlyBills({ importKwh, exportKwh })[0]).toEqual({ month: 1, totalZar: 248, exportCreditUsedZar: 1240 })
  })

  it('k = 1.5: credit used is capped at the energy charges (R1,488, not the naive R1,860) and the rest carries to February', () => {
    const out = calc.withExportRateScaled(1.5).monthlyBills({ importKwh, exportKwh })
    expect(out[0]).toEqual({ month: 1, totalZar: 0, exportCreditUsedZar: 1488 })
    expect(out[0]!.exportCreditUsedZar).toBeLessThan(1240 * 1.5)
    expect(out[1]!.exportCreditUsedZar).toBe(372) // 1,860 - 1,488 carried into February and used there
    const direct = costHourly(scaled(1.5), { importKwh, exportKwh }, { calendar: CAL, year: 2025, sseg, holidays: referenceYearHolidays(2025) })
    expect(out.map((b) => b.exportCreditUsedZar)).toEqual(direct.map((b) => b.credit.used))
    expect(out.map((b) => b.totalZar)).toEqual(direct.map((b) => b.totalExclVat))
    for (const b of direct) expect(b.credit.used).toBeLessThanOrEqual(b.energyCharges)
  })

  it('scales a linked export tariff (Gen-offset) and never the import energy rates', () => {
    const gen = makeTariff({ name: 'gen-offset', structure: 'flat', charges: [
      makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
    ] })
    const linked = tariffBillCalculator(tariff, { calendar: CAL, referenceYear: 2025, sseg, exportTariff: gen })
    const noExport = new Float64Array(N)
    // Import-only bill is unchanged by the export scaling.
    expect(linked.withExportRateScaled(1.5).monthlyBills({ importKwh, exportKwh: noExport })).toEqual(linked.monthlyBills({ importKwh, exportKwh: noExport }))
    expect(linked.withExportRateScaled(0.5).monthlyBills({ importKwh, exportKwh })[0]!.exportCreditUsedZar).toBe(620)
  })

  it('refuses a non-positive or non-finite factor', () => {
    expect(() => calc.withExportRateScaled(0)).toThrow(RangeError)
    expect(() => calc.withExportRateScaled(Number.NaN)).toThrow(RangeError)
  })
})
