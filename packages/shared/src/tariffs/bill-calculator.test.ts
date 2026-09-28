import { describe, expect, it } from 'vitest'
import { costHourly, createBillCalculator } from './bill-calculator'
import { netBillingRule } from './net-billing-rules'
import { makeCharge, makeTariff } from './types'
import type { TouCalendar } from './tou'

// Every hour is off-peak: the calendar has no windows. Keeps the arithmetic by hand.
const CAL: TouCalendar = { highSeasonMonths: [6, 7, 8], windows: [], holidayTreatedAs: null, source: 'assumed_eskom' }
const flat = makeTariff({ name: 'flat SSEG', structure: 'flat', charges: [
  makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
  makeCharge({ component: 'basic', unit: 'R_per_month', amountExclVat: 100 }),
  makeCharge({ component: 'export_credit', unit: 'R_per_kWh', amountExclVat: 1 }),
] })
const N = 8760
// Import 1 kWh every hour; export 2 kWh at noon only.
const importKwh = new Float64Array(N).fill(1)
const exportKwh = Float64Array.from({ length: N }, (_, h) => (h % 24 === 12 ? 2 : 0))

describe('hourly adapter (Phase 4a BillCalculator seam)', () => {
  it('prices import and export as SEPARATE series, not a net load', () => {
    const bills = costHourly(flat, { importKwh, exportKwh }, { calendar: CAL, year: 2025, sseg: netBillingRule('municipal', { touExport: false }) })
    expect(bills).toHaveLength(12)
    const jan = bills[0]
    // 744 kWh import at R2 + R100; 62 kWh export at R1 credited (capped at import, well under it).
    expect(jan.energyCharges).toBe(1488)
    expect(jan.credit.earned).toBe(62)
    expect(jan.totalExclVat).toBe(1488 + 100 - 62)
  })

  it('returns twelve {month, totalZar, exportCreditUsedZar} summaries with carry between months', () => {
    const calc = createBillCalculator(flat, CAL, undefined, { year: 2025, sseg: netBillingRule('municipal', { touExport: false }) })
    const out = calc.monthlyBills({ importKwh, exportKwh })
    expect(out.map((m) => m.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    expect(out[0]).toEqual({ month: 1, totalZar: 1526, exportCreditUsedZar: 62 })
    for (const m of out) expect(m.exportCreditUsedZar).toBeGreaterThanOrEqual(0)
  })

  it('settles the year in the distributor financial year, so Oct-Dec credit reaches Jan-Mar (Eskom) and nothing is dropped', () => {
    // Import 1 kWh/h all year; export 10 kWh at noon in November only -> 300 kWh credit at R1, far above November's energy.
    const exportNov = Float64Array.from({ length: N }, (_, h) => (h >= 7296 && h < 8016 && h % 24 === 12 ? 10 : 0))
    const eskomFlat = { ...netBillingRule('eskom', { touExport: false }), capRule: 'energy_charges' as const }
    const bills = costHourly(flat, { importKwh, exportKwh: exportNov }, { calendar: CAL, year: 2025, sseg: eskomFlat })
    expect(bills.map((b) => b.month)).toEqual([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12])
    const nov = bills[10]
    const dec = bills[11]
    const jan = bills[0]
    expect(nov.credit.earned).toBe(300)
    // November energy is 720 kWh x R2 = R1,440 > R300, so it is all used in November itself.
    expect(nov.credit.used).toBe(300)
    // A carry that crosses December must survive into January for Eskom (FY ends in March).
    const big = Float64Array.from({ length: N }, (_, h) => (h >= 7296 && h < 8016 ? 10 : 0))
    const b2 = costHourly(flat, { importKwh, exportKwh: big }, { calendar: CAL, year: 2025, sseg: eskomFlat })
    expect(b2[10].credit.carriedOut).toBeGreaterThan(0)
    expect(b2[11].credit.carriedIn).toBe(b2[10].credit.carriedOut)
    expect(b2[0].credit.carriedIn).toBe(b2[11].credit.carriedOut)
    expect(b2[0].credit.used).toBeGreaterThan(0)
    expect(dec.credit.forfeited + jan.credit.forfeited).toBe(0)
  })

  it('refuses series that are not 8760 hours', () => {
    const calc = createBillCalculator(flat, CAL)
    expect(() => calc.monthlyBills({ importKwh: new Float64Array(10), exportKwh })).toThrow(RangeError)
  })
})
