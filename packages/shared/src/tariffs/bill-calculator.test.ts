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

describe('golden (hand-computed): Megaflex-like month, network demand on PEAK-WINDOW demand', () => {
  // Weekday peak 06-08 and 17-20, standard 08-17 and 20-22; weekends off-peak (synthetic, not Eskom's).
  const w = (season: 'high' | 'low', s: number, e: number, period: 'peak' | 'standard') => ({ season, dayType: 'weekday' as const, startMinute: s, endMinute: e, period })
  const TOU_CAL: TouCalendar = {
    highSeasonMonths: [6, 7, 8], holidayTreatedAs: 'sunday', source: 'assumed_eskom',
    windows: (['high', 'low'] as const).flatMap((s) => [w(s, 360, 480, 'peak'), w(s, 480, 1020, 'standard'), w(s, 1020, 1200, 'peak'), w(s, 1200, 1320, 'standard')]),
  }
  const tou = (t: 'peak' | 'standard' | 'off_peak', cents: number) => makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: cents, tou: t })
  const megaflexLike = makeTariff({ name: 'Megaflex-like', structure: 'tou', charges: [
    tou('peak', 300), tou('standard', 150), tou('off_peak', 100),
    makeCharge({ component: 'network_demand', unit: 'R_per_kVA_month', amountExclVat: 48.41, demandBasis: 'peak_window_md' }),
    makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 39.22, demandBasis: 'utilised_capacity' }),
  ] })
  // 10 kWh every hour; an OFF-PEAK spike of 100 kWh (Sat 4 Jan 02:00) and a PEAK hour of 60 kWh (Mon 6 Jan 07:00).
  const hourly = new Float64Array(N).fill(10)
  hourly[3 * 24 + 2] = 100
  hourly[5 * 24 + 7] = 60
  const opts = { calendar: TOU_CAL, year: 2025, demandForMonth: () => ({ nmdKva: 80 }) }

  it('hourly: peak-window MD 60 kVA (overall MD 100 is off-peak) -> R18,071.60', () => {
    // Energy: peak 23x5x10+50 = 1,200 kWh x R3 = 3,600; standard 23x11x10 = 2,530 x R1.50 = 3,795;
    //         off-peak 7,580-1,200-2,530 = 3,850 x R1 = 3,850 -> 11,245.00
    // Network demand 60 kVA x 48.41 = 2,904.60 (not 100 x 48.41 = 4,841.00)
    // Network capacity max(NMD 80, MD 100) = 100 x 39.22 = 3,922.00
    const [jan] = costHourly(megaflexLike, { importKwh: hourly, exportKwh: new Float64Array(N) }, opts)
    expect(jan.energyCharges).toBe(11245)
    expect(jan.lines.find((l) => l.component === 'network_demand')).toMatchObject({ quantity: 60, amount: 2904.6 })
    expect(jan.lines.find((l) => l.component === 'network_capacity')).toMatchObject({ quantity: 100 })
    expect(jan.totalExclVat).toBe(18071.6)
  })

  it('sub-hourly (30-min) data takes precedence for demand: 50 kWh in 07:00-07:30 = 100 kW -> R20,008.00', () => {
    const half = new Float64Array(2 * N).fill(5)
    half[2 * (3 * 24 + 2)] = 50; half[2 * (3 * 24 + 2) + 1] = 50 // Sat 02:00 hour = 100 kWh (100 kW both halves)
    half[2 * (5 * 24 + 7)] = 50; half[2 * (5 * 24 + 7) + 1] = 10 // Mon 07:00 hour = 60 kWh, first half 100 kW
    const calc = createBillCalculator(megaflexLike, TOU_CAL, undefined, { year: 2025, demandForMonth: () => ({ nmdKva: 80 }) })
    const [jan] = calc.monthlyBills({ importKwh: hourly, exportKwh: new Float64Array(N), subHourlyImport: { intervalMinutes: 30, kwh: half } })
    expect(jan.totalZar).toBe(20008) // 11,245 + 100 x 48.41 + 100 x 39.22
  })
})
