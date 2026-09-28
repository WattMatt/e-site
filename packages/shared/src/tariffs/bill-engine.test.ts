import { describe, expect, it } from 'vitest'
import { costMonth } from './bill-engine'
import { makeCharge, makeTariff, type Charge, type ChargeComponent, type MonthUsage, type TariffSeason, type TariffUnit, type TouOrAll } from './types'

function usage(p: Partial<MonthUsage> & { kwh?: number } = {}): MonthUsage {
  const { kwh, ...rest } = p
  return { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: kwh ?? 0, off_peak: 0 }, ...rest }
}
const block = (min: number, max: number | null, amount: number, unit: TariffUnit = 'c_per_kWh', season: TariffSeason = 'all'): Charge =>
  makeCharge({ component: 'energy', unit, amountExclVat: amount, blockMinKwh: min, blockMaxKwh: max, blockBasis: 'monthly', season })
const tou = (season: TariffSeason, t: TouOrAll, cents: number): Charge =>
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: cents, season, tou: t })
const monthly = (component: ChargeComponent, rand: number): Charge => makeCharge({ component, unit: 'R_per_month', amountExclVat: rand })

describe('golden tariff cases (as-is/09 §7.2), import side', () => {
  it('1. City Power Residential Single Phase 60A: 5-block IBT, 800 kWh -> R2,849.26', () => {
    const t = makeTariff({ name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
      block(0, 500, 227.28), block(500, 1000, 260.83), block(1000, 2000, 280.08), block(2000, 3000, 295.5), block(3000, null, 310),
      monthly('service', 235.79), monthly('network_capacity', 694.58),
    ] })
    const bill = costMonth(t, usage({ kwh: 800 }))
    expect(bill.energyCharges).toBe(1918.89)
    expect(bill.totalExclVat).toBe(2849.26)
  })

  it('2. City Power Residential TOU (<=80A), high season P100/S200/O300 -> R2,890.51', () => {
    const t = makeTariff({ name: 'Residential Time of Use (<=80A)', structure: 'tou', charges: [
      tou('low', 'peak', 275.58), tou('low', 'standard', 218), tou('low', 'off_peak', 171.5),
      tou('high', 'peak', 634.02), tou('high', 'standard', 259.72), tou('high', 'off_peak', 183.27),
      monthly('service', 235.79), monthly('network_capacity', 951.45),
    ] })
    const bill = costMonth(t, usage({ month: 7, season: 'high', importKwh: { peak: 100, standard: 200, off_peak: 300 } }))
    expect(bill.totalExclVat).toBe(2890.51)
  })

  it('3. City Power Industrial LV (TOU), summer, MD 100 kVA, 0 kVArh -> R59,556.92', () => {
    const t = makeTariff({ name: 'Industrial LV (TOU)', structure: 'tou', charges: [
      tou('low', 'peak', 267.76), tou('low', 'standard', 201.59), tou('low', 'off_peak', 154.96),
      tou('high', 'peak', 637.16), tou('high', 'standard', 243.27), tou('high', 'off_peak', 166.67),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 358.84, demandBasis: 'actual_md' }),
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 37.64 }),
      monthly('service', 1895.11), monthly('network_capacity', 1694.31),
    ] })
    const bill = costMonth(t, usage({ importKwh: { peak: 2000, standard: 5000, off_peak: 3000 }, maxDemandKva: 100, kvarh: 0 }))
    expect(bill.energyCharges).toBe(20083.5)
    expect(bill.lines.find((l) => l.kind === 'demand')?.amount).toBe(35884)
    expect(bill.lines.find((l) => l.kind === 'reactive')?.amount).toBe(0)
    expect(bill.totalExclVat).toBe(59556.92)
  })

  it('4. Ekurhuleni Domestic IBT Tariff A, unitless R/kWh, 800 kWh -> R2,901.63 (total rounded once)', () => {
    const t = makeTariff({ name: 'Domestic IBT Tariff A', structure: 'ibt', charges: [
      block(0, 50, 2.3231, 'R_per_kWh'), block(50, 600, 2.3231, 'R_per_kWh'),
      block(600, 700, 3.9486, 'R_per_kWh'), block(700, null, 11.1291, 'R_per_kWh'),
    ] })
    expect(costMonth(t, usage({ kwh: 800 })).totalExclVat).toBe(2901.63)
  })

  it('5. Lephalale Domestic Prepaid & Conventional, 400 kWh -> R1,061.25', () => {
    const t = makeTariff({ name: 'Domestic Prepaid & Conventional', structure: 'ibt', charges: [
      block(0, 50, 1.6464, 'R_per_kWh'), block(50, 350, 2.0889, 'R_per_kWh'),
      block(350, 600, 3.0002, 'R_per_kWh'), block(600, null, 3.6052, 'R_per_kWh'),
      monthly('basic', 202.25),
    ] })
    expect(costMonth(t, usage({ kwh: 400 })).totalExclVat).toBe(1061.25)
  })

  it('6. Buffalo City Scale 1A, energy stored as the inferred R/kWh, 500 kWh -> R2,209.00', () => {
    const t = makeTariff({ name: 'Scale 1A', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true, inferenceReason: 'magnitude: labelled c/kWh but 3.09 < 20, read as R/kWh' }),
      monthly('basic', 664),
    ] })
    expect(costMonth(t, usage({ kwh: 500 })).totalExclVat).toBe(2209)
  })

  it('7. Cape Town Large User LV TOU, high season, basic R/day x 30, MD 200 kVA -> R130,224.30', () => {
    const t = makeTariff({ name: 'Large User Low Voltage Time of Use', structure: 'tou', charges: [
      makeCharge({ component: 'basic', unit: 'R_per_day', amountExclVat: 168.81 }),
      tou('low', 'peak', 203.8), tou('low', 'standard', 142.41), tou('low', 'off_peak', 92.8),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'low', demandBasis: 'actual_md' }),
      makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'low', demandBasis: 'nmd' }),
      tou('high', 'peak', 610.75), tou('high', 'standard', 189.75), tou('high', 'off_peak', 106.18),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'high', demandBasis: 'actual_md' }),
      makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'high', demandBasis: 'nmd' }),
    ] })
    const bill = costMonth(t, usage({
      month: 7, season: 'high', days: 30,
      importKwh: { peak: 5000, standard: 15000, off_peak: 10000 }, maxDemandKva: 200, nmdKva: 200,
    }))
    expect(bill.lines.filter((l) => l.kind === 'demand')).toHaveLength(1)
    expect(bill.energyCharges).toBe(69618)
    expect(bill.totalExclVat).toBe(130224.3)
  })

  it('8. Maluti-a-Phofung domestic single phase, summer, 400 kWh -> R1,275.84', () => {
    const t = makeTariff({ name: 'DOMESTIC NON RURAL', structure: 'seasonal_ibt', charges: [
      block(0, 50, 1.68, 'R_per_kWh', 'low'), block(50, 350, 2.18, 'R_per_kWh', 'low'),
      block(350, 600, 3.08, 'R_per_kWh', 'low'), block(600, null, 3.49, 'R_per_kWh', 'low'),
      block(0, 50, 1.79, 'R_per_kWh', 'high'), block(50, 350, 2.35, 'R_per_kWh', 'high'),
      monthly('basic', 383.84),
    ] })
    expect(costMonth(t, usage({ kwh: 400, season: 'low' })).totalExclVat).toBe(1275.84)
  })
})

describe('engine rules', () => {
  it('scales daily-basis blocks by the days in the month', () => {
    const t = makeTariff({ name: 'daily blocks', structure: 'ibt', charges: [
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 100, blockMinKwh: 0, blockMaxKwh: 10, blockBasis: 'daily' }),
      makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: 200, blockMinKwh: 10, blockMaxKwh: null, blockBasis: 'daily' }),
    ] })
    // 30 days x 10 kWh = 300 kWh at R1, then 100 kWh at R2
    expect(costMonth(t, usage({ kwh: 400, days: 30 })).totalExclVat).toBe(500)
  })

  it('charges amp-based capacity on the rating and adds VAT at the stored rate', () => {
    const t = makeTariff({ name: 'amps', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
      makeCharge({ component: 'capacity_amp', unit: 'R_per_A_month', amountExclVat: 10 }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100, ampsRating: 60 }))
    expect(bill.totalExclVat).toBe(800)
    expect(bill.vat).toBe(120)
    expect(bill.totalInclVat).toBe(920)
  })

  it('lists, never silently drops, a charge it cannot cost', () => {
    const t = makeTariff({ name: 'gaps', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 30 }),
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 300 }),
      makeCharge({ component: 'other', unit: 'pct', amountExclVat: 2 }),
      makeCharge({ component: 'wheeling_uos', unit: 'c_per_kWh', amountExclVat: 20 }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100 }))
    expect(bill.notModelled.map((n) => n.chargeIndex)).toEqual([1, 2, 3, 4])
    expect(bill.notModelled[0].reason).toMatch(/kVArh/)
    expect(bill.totalExclVat).toBe(200)
  })

  it('does not cost TOU with inclining blocks, and says so', () => {
    const t = makeTariff({ name: 'tou_ibt', structure: 'tou_ibt', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2, tou: 'peak' }),
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 1, blockMinKwh: 0, blockMaxKwh: null, blockBasis: 'monthly' }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100 }))
    expect(bill.energyCharges).toBe(0)
    expect(bill.notModelled).toHaveLength(2)
  })

  it('floors an actual-MD demand charge at the NMD (spec §5.4: max(chargeable MD, NMD))', () => {
    const t = makeTariff({ name: 'md', structure: 'flat', charges: [
      makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 100, demandBasis: 'actual_md' }),
    ] })
    expect(costMonth(t, usage({ maxDemandKva: 80, nmdKva: 120 })).totalExclVat).toBe(12000)
    expect(costMonth(t, usage({ maxDemandKva: 150, nmdKva: 120 })).totalExclVat).toBe(15000)
    expect(costMonth(t, usage({ maxDemandKva: 80 })).totalExclVat).toBe(8000)
  })

  it('lists a day-type-specific charge as not modelled rather than billing it on every day', () => {
    const t = makeTariff({ name: 'weekday', structure: 'flat', charges: [
      makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 2 }),
      makeCharge({ component: 'ancillary', unit: 'c_per_kWh', amountExclVat: 10, dayType: 'weekday' }),
    ] })
    const bill = costMonth(t, usage({ kwh: 100 }))
    expect(bill.notModelled.map((n) => n.chargeIndex)).toEqual([1])
    expect(bill.totalExclVat).toBe(200)
  })

  it('charges reactive energy only above 30% of active energy', () => {
    const t = makeTariff({ name: 'reactive', structure: 'flat', charges: [
      makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 40 }),
    ] })
    // 1000 kWh, 500 kVArh: 500 - 300 = 200 chargeable x R0.40
    expect(costMonth(t, usage({ kwh: 1000, kvarh: 500 })).totalExclVat).toBe(80)
  })
})
