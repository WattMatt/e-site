import { describe, expect, it } from 'vitest'
import { makeCharge, makeTariff } from '../tariffs/types'
import type { TouCalendar, TouWindow } from '../tariffs/tou'
import { analyseProfile } from './analyse'
import { costProfile, isCalendarIndependent, mdByCalendarMonth, NEUTRAL_CALENDAR } from './cost'
import { measuredReferenceSeries } from './measured'
import { handCheckedReadings } from './__fixtures__/hand-checked'
import { GOLDEN_CITY_POWER_INDUSTRIAL_LV } from '../tariffs/__fixtures__/golden-bills'
import { tariffBillCalculator } from '../services/solar/finance/tariff-bill-calculator'

/** Weekday 07–10 peak, 10–18 standard, else off-peak; weekends off-peak; holidays as Sunday. Both seasons. */
const w = (season: 'high' | 'low', dayType: 'weekday' | 'saturday' | 'sunday', s: number, e: number, period: TouWindow['period']): TouWindow => ({ season, dayType, startMinute: s * 60, endMinute: e * 60, period })
const windows: TouWindow[] = (['high', 'low'] as const).flatMap((season) => [
  w(season, 'weekday', 0, 7, 'off_peak'), w(season, 'weekday', 7, 10, 'peak'), w(season, 'weekday', 10, 18, 'standard'), w(season, 'weekday', 18, 24, 'off_peak'),
  w(season, 'saturday', 0, 24, 'off_peak'), w(season, 'sunday', 0, 24, 'off_peak'),
])
const calendar: TouCalendar = { highSeasonMonths: [6, 7, 8], windows, holidayTreatedAs: 'sunday', source: 'published' }
const tariff = makeTariff({ name: 'Hand TOU', structure: 'tou', charges: [
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 300, tou: 'peak' }),
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, tou: 'standard' }),
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100, tou: 'off_peak' }),
  makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 100, demandBasis: 'actual_md' }),
  makeCharge({ component: 'service', unit: 'R_per_month', amountExclVat: 500 }),
] })

describe('costProfile — hand-checked January 2025', () => {
  const readings = handCheckedReadings()
  const series = measuredReferenceSeries(readings, 30, 2025).series
  const a = analyseProfile({ series, referenceYear: 2025, powerFactor: 0.95, measured: [{ kw: readings, kva: null, intervalMin: 30 }], syntheticPeakKw: 0 })
  const c = costProfile({ tariff, calendar, series, referenceYear: 2025, powerFactor: 0.95, mdKvaByMonth: mdByCalendarMonth(a.md!.months), nmdKva: 175 })
  const jan = c.months[0]

  // January: 23 Mon–Fri, of which 1 Jan (Wed) is a public holidays → off-peak all day (1 200 kWh).
  // 22 working days: peak 07–10 = 20 + 100 + 100 = 220 kWh → 4 840; standard 10–18 = 7 × 100 + 20 = 720 → 15 840.
  // Off-peak = 31 440 − 4 840 − 15 840 = 10 760 (22 × 260 + 1 200 + 8 × 480).
  it('splits January by TOU period', () => {
    expect(jan.tou.peak).toBeCloseTo(4_840, 6)
    expect(jan.tou.standard).toBeCloseTo(15_840, 6)
    expect(jan.tou.off_peak).toBeCloseTo(10_760, 6)
  })
  // Energy 4 840 × 3 + 15 840 × 2 + 10 760 × 1 = 56 960; demand max(105.26, NMD 175) × R100 = 17 500; service 500.
  it('bills January: R 74 960.00 excl VAT, R 86 204.00 incl', () => {
    expect(jan.bill.totalExclVat).toBeCloseTo(74_960, 6)
    expect(jan.bill.totalInclVat).toBeCloseTo(86_204, 6)
    expect(jan.mdKva).toBeCloseTo(100 / 0.95, 9)
  })
  it('annual kWh equals the profile', () => {
    expect(c.annual.kwh).toBeCloseTo(a.kpis.annualKwh, 6)
    expect(c.annual.tou.peak + c.annual.tou.standard + c.annual.tou.off_peak).toBeCloseTo(a.kpis.annualKwh, 6)
  })
})

describe('costProfile — parity with the Solar tariff tab for the same tariff', () => {
  it('every month equals tariffBillCalculator (City Power Industrial LV TOU: energy, demand, reactive, fixed)', () => {
    const series = measuredReferenceSeries(handCheckedReadings(), 30, 2025).series
    const mine = costProfile({ tariff: GOLDEN_CITY_POWER_INDUSTRIAL_LV, calendar, series, referenceYear: 2025, powerFactor: 0.95, nmdKva: 175 })
    const solar = tariffBillCalculator(GOLDEN_CITY_POWER_INDUSTRIAL_LV, { calendar, referenceYear: 2025, powerFactor: 0.95, demandForMonth: () => ({ nmdKva: 175 }) })
      .monthlyBills({ importKwh: series, exportKwh: new Float64Array(8760) })
    expect(mine.months.map((m) => m.bill.totalExclVat)).toEqual(solar.map((b) => b.totalZar))
    expect(mine.annual.totalExclVat).toBeGreaterThan(0)
  })
})

describe('calendar-independent tariffs', () => {
  const flatTariff = makeTariff({ name: 'Business flat', structure: 'flat', charges: [
    makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 250 }),
    makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 100, demandBasis: 'actual_md' }),
    makeCharge({ component: 'service', unit: 'R_per_month', amountExclVat: 500 }),
  ] })
  it('recognises a tariff with no seasonal, TOU or day-type charge; refuses the TOU one', () => {
    expect(isCalendarIndependent(flatTariff)).toBe(true)
    expect(isCalendarIndependent(tariff)).toBe(false)
    expect(isCalendarIndependent(makeTariff({ name: 's', structure: 'flat', charges: [makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 1, season: 'high' })] }))).toBe(false)
  })
  it('bills the same under the neutral calendar as under a real one', () => {
    const series = measuredReferenceSeries(handCheckedReadings(), 30, 2025).series
    const a = costProfile({ tariff: flatTariff, calendar: NEUTRAL_CALENDAR, series, referenceYear: 2025, powerFactor: 0.95, nmdKva: 175 })
    const b = costProfile({ tariff: flatTariff, calendar, series, referenceYear: 2025, powerFactor: 0.95, nmdKva: 175 })
    expect(a.months.map((m) => m.bill.totalExclVat)).toEqual(b.months.map((m) => m.bill.totalExclVat))
    // January by hand: 31 440 kWh × R2.50 + 175 kVA × R100 + R500 = 78 600 + 17 500 + 500.
    expect(a.months[0].bill.totalExclVat).toBeCloseTo(96_600, 6)
  })
})
