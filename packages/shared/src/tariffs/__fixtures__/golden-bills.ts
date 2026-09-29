/**
 * The 2a golden tariff cases (as-is/09 §7.2) as DATA, so more than one suite can prove it reproduces
 * them: bill-engine.test.ts / bill-engine.net-billing.test.ts (the engine) and
 * solar/tariff/pricing.test.ts (the study pricing resolver, which must reproduce every one exactly
 * when the study has no override and no stored rule). Values are unchanged from the original tests.
 */
import type { CostOptions } from '../bill-engine'
import { netBillingRule } from '../net-billing-rules'
import {
  makeCharge, makeTariff,
  type Charge, type ChargeComponent, type MonthUsage, type SsegRule, type Tariff, type TariffSeason, type TariffUnit, type TouOrAll,
} from '../types'

export function goldenUsage(p: Partial<MonthUsage> & { kwh?: number } = {}): MonthUsage {
  const { kwh, ...rest } = p
  return { year: 2025, month: 1, days: 30, season: 'low', importKwh: { peak: 0, standard: kwh ?? 0, off_peak: 0 }, ...rest }
}
const block = (min: number, max: number | null, amount: number, unit: TariffUnit = 'c_per_kWh', season: TariffSeason = 'all'): Charge =>
  makeCharge({ component: 'energy', unit, amountExclVat: amount, blockMinKwh: min, blockMaxKwh: max, blockBasis: 'monthly', season })
const tou = (season: TariffSeason, t: TouOrAll, cents: number): Charge =>
  makeCharge({ component: 'energy', unit: 'c_per_kWh', amountExclVat: cents, season, tou: t })
const monthly = (component: ChargeComponent, rand: number): Charge => makeCharge({ component, unit: 'R_per_month', amountExclVat: rand })

export const GOLDEN_CITY_POWER_RES_60A = makeTariff({ name: 'Residential Single Phase 60A', structure: 'ibt', charges: [
  block(0, 500, 227.28), block(500, 1000, 260.83), block(1000, 2000, 280.08), block(2000, 3000, 295.5), block(3000, null, 310),
  monthly('service', 235.79), monthly('network_capacity', 694.58),
] })
export const GOLDEN_CITY_POWER_RES_TOU = makeTariff({ name: 'Residential Time of Use (<=80A)', structure: 'tou', charges: [
  tou('low', 'peak', 275.58), tou('low', 'standard', 218), tou('low', 'off_peak', 171.5),
  tou('high', 'peak', 634.02), tou('high', 'standard', 259.72), tou('high', 'off_peak', 183.27),
  monthly('service', 235.79), monthly('network_capacity', 951.45),
] })
export const GOLDEN_CITY_POWER_INDUSTRIAL_LV = makeTariff({ name: 'Industrial LV (TOU)', structure: 'tou', charges: [
  tou('low', 'peak', 267.76), tou('low', 'standard', 201.59), tou('low', 'off_peak', 154.96),
  tou('high', 'peak', 637.16), tou('high', 'standard', 243.27), tou('high', 'off_peak', 166.67),
  makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 358.84, demandBasis: 'actual_md' }),
  makeCharge({ component: 'reactive', unit: 'c_per_kVArh', amountExclVat: 37.64 }),
  monthly('service', 1895.11), monthly('network_capacity', 1694.31),
] })
export const GOLDEN_EKURHULENI_IBT_A = makeTariff({ name: 'Domestic IBT Tariff A', structure: 'ibt', charges: [
  block(0, 50, 2.3231, 'R_per_kWh'), block(50, 600, 2.3231, 'R_per_kWh'),
  block(600, 700, 3.9486, 'R_per_kWh'), block(700, null, 11.1291, 'R_per_kWh'),
] })
export const GOLDEN_LEPHALALE_DOMESTIC = makeTariff({ name: 'Domestic Prepaid & Conventional', structure: 'ibt', charges: [
  block(0, 50, 1.6464, 'R_per_kWh'), block(50, 350, 2.0889, 'R_per_kWh'),
  block(350, 600, 3.0002, 'R_per_kWh'), block(600, null, 3.6052, 'R_per_kWh'),
  monthly('basic', 202.25),
] })
export const GOLDEN_BUFFALO_CITY_1A = makeTariff({ name: 'Scale 1A', structure: 'flat', charges: [
  makeCharge({ component: 'energy', unit: 'R_per_kWh', amountExclVat: 3.09, unitInferred: true, inferenceReason: 'magnitude: labelled c/kWh but 3.09 < 20, read as R/kWh' }),
  monthly('basic', 664),
] })
export const GOLDEN_CAPE_TOWN_LARGE_LV_TOU = makeTariff({ name: 'Large User Low Voltage Time of Use', structure: 'tou', charges: [
  makeCharge({ component: 'basic', unit: 'R_per_day', amountExclVat: 168.81 }),
  tou('low', 'peak', 203.8), tou('low', 'standard', 142.41), tou('low', 'off_peak', 92.8),
  makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'low', demandBasis: 'actual_md' }),
  makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'low', demandBasis: 'nmd' }),
  tou('high', 'peak', 610.75), tou('high', 'standard', 189.75), tou('high', 'off_peak', 106.18),
  makeCharge({ component: 'demand', unit: 'R_per_kVA_month', amountExclVat: 277.71, season: 'high', demandBasis: 'actual_md' }),
  makeCharge({ component: 'network_capacity', unit: 'R_per_kVA_month', amountExclVat: 0, season: 'high', demandBasis: 'nmd' }),
] })
export const GOLDEN_MALUTI_DOMESTIC = makeTariff({ name: 'DOMESTIC NON RURAL', structure: 'seasonal_ibt', charges: [
  block(0, 50, 1.68, 'R_per_kWh', 'low'), block(50, 350, 2.18, 'R_per_kWh', 'low'),
  block(350, 600, 3.08, 'R_per_kWh', 'low'), block(600, null, 3.49, 'R_per_kWh', 'low'),
  block(0, 50, 1.79, 'R_per_kWh', 'high'), block(50, 350, 2.35, 'R_per_kWh', 'high'),
  monthly('basic', 383.84),
] })

// Eskom 2025/26, xlsm `Homeflex NLA` row 11 (HF101N) and row 18; `Gen-offset` row 49 (GOHF101N).
const c10 = (season: TariffSeason, t: TouOrAll, cents: number, component: Charge['component'] = 'energy'): Charge =>
  makeCharge({ component, unit: 'c_per_kWh', amountExclVat: cents, season, tou: t })
const perDay = (component: Charge['component'], rand: number, demandBasis: Charge['demandBasis'] = null): Charge =>
  makeCharge({ component, unit: 'R_per_POD_day', amountExclVat: rand, demandBasis })
export const GOLDEN_HOMEFLEX_1 = makeTariff({ name: 'Homeflex 1 (HF101N)', code: 'HF101N', structure: 'tou', exportTariffCode: 'GOHF101N', charges: [
  c10('high', 'peak', 706.97), c10('high', 'standard', 216.31), c10('high', 'off_peak', 159.26),
  c10('low', 'peak', 329.28), c10('low', 'standard', 204.9), c10('low', 'off_peak', 159.26),
  perDay('service', 3.27),
  c10('all', 'all', 0.41, 'ancillary'), c10('all', 'all', 22.78, 'legacy'), c10('all', 'all', 26.37, 'network_demand'),
  perDay('network_capacity', 12.13, 'nmd'), perDay('gcc', 0.72),
] })
export const GOLDEN_GEN_OFFSET_HOMEFLEX = makeTariff({ name: 'Gen-Offset Homeflex (GOHF101N)', code: 'GOHF101N', structure: 'tou', category: 'sseg', charges: [
  c10('high', 'peak', 650.52, 'export_credit'), c10('high', 'standard', 185.41, 'export_credit'), c10('high', 'off_peak', 131.21, 'export_credit'),
  c10('low', 'peak', 292.75, 'export_credit'), c10('low', 'standard', 174.58, 'export_credit'), c10('low', 'off_peak', 131.21, 'export_credit'),
] })
export const GOLDEN_ESKOM_RULE: SsegRule = netBillingRule('eskom')
const july = (importKwh: MonthUsage['importKwh'], exportKwh: MonthUsage['exportKwh']): MonthUsage =>
  ({ year: 2025, month: 7, days: 30, season: 'high', importKwh, exportKwh })

export interface GoldenBill {
  id: string
  tariff: Tariff
  usage: MonthUsage
  /** The linked export tariff and the licensee's SSEG rule, when the case exports. */
  exportTariff?: Tariff
  sseg?: SsegRule
  totalExclVat: number
}

export const GOLDEN_BILLS: readonly GoldenBill[] = [
  { id: '1', tariff: GOLDEN_CITY_POWER_RES_60A, usage: goldenUsage({ kwh: 800 }), totalExclVat: 2849.26 },
  { id: '2', tariff: GOLDEN_CITY_POWER_RES_TOU, usage: goldenUsage({ month: 7, season: 'high', importKwh: { peak: 100, standard: 200, off_peak: 300 } }), totalExclVat: 2890.51 },
  { id: '3', tariff: GOLDEN_CITY_POWER_INDUSTRIAL_LV, usage: goldenUsage({ importKwh: { peak: 2000, standard: 5000, off_peak: 3000 }, maxDemandKva: 100, kvarh: 0 }), totalExclVat: 59556.92 },
  { id: '4', tariff: GOLDEN_EKURHULENI_IBT_A, usage: goldenUsage({ kwh: 800 }), totalExclVat: 2901.63 },
  { id: '5', tariff: GOLDEN_LEPHALALE_DOMESTIC, usage: goldenUsage({ kwh: 400 }), totalExclVat: 1061.25 },
  { id: '6', tariff: GOLDEN_BUFFALO_CITY_1A, usage: goldenUsage({ kwh: 500 }), totalExclVat: 2209 },
  { id: '7', tariff: GOLDEN_CAPE_TOWN_LARGE_LV_TOU, usage: goldenUsage({ month: 7, season: 'high', days: 30, importKwh: { peak: 5000, standard: 15000, off_peak: 10000 }, maxDemandKva: 200, nmdKva: 200 }), totalExclVat: 130224.3 },
  { id: '8', tariff: GOLDEN_MALUTI_DOMESTIC, usage: goldenUsage({ kwh: 400, season: 'low' }), totalExclVat: 1275.84 },
  { id: '10', tariff: GOLDEN_HOMEFLEX_1, usage: july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 150, off_peak: 0 }), exportTariff: GOLDEN_GEN_OFFSET_HOMEFLEX, sseg: GOLDEN_ESKOM_RULE, totalExclVat: 2177.26 },
  { id: '10b', tariff: GOLDEN_HOMEFLEX_1, usage: july({ peak: 100, standard: 300, off_peak: 200 }, { peak: 0, standard: 400, off_peak: 0 }), exportTariff: GOLDEN_GEN_OFFSET_HOMEFLEX, sseg: GOLDEN_ESKOM_RULE, totalExclVat: 1899.15 },
]

export const goldenCostOptions = (g: GoldenBill): CostOptions => ({ exportTariff: g.exportTariff ?? null, sseg: g.sseg ?? null })
