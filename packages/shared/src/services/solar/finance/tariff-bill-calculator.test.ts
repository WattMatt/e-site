import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff } from '../../../tariffs/types'
import { costHourly } from '../../../tariffs/bill-calculator'
import { netBillingRule } from '../../../tariffs/net-billing-rules'
import type { TouCalendar } from '../../../tariffs/tou'
import type { SubHourlyLoad } from '../energy/max-demand'
import { referenceYearHolidays, tariffBillCalculator, toSubHourlyKwh } from './tariff-bill-calculator'

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
  it('lists SA public holidays of the year as YYYY-MM-DD keys the TOU calendar understands, dropping 29 Feb', () => {
    const h = referenceYearHolidays(2025)
    expect(h.has('2025-01-01')).toBe(true)
    expect(h.has('2025-04-18')).toBe(true) // Good Friday 2025
    expect(h.has('2025-12-25')).toBe(true)
    expect(h.has('2025-12-24')).toBe(false)
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
