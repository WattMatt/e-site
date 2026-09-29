/**
 * Hourly adapter over the bill engine — the seam the Phase 4a finance model
 * consumes (its `BillCalculator.monthlyBills(flows)`). Shapes are kept
 * structurally compatible with 4a without importing it; the names here are
 * prefixed so the two barrels never collide when both land.
 *
 * Import and export are SEPARATE hourly series: net billing caps credited kWh
 * per TOU period at that period's import and carries unused credit between
 * months (Net-Billing Rules pp7-12), so a single net-load series cannot be
 * priced correctly.
 */
import { costPeriod, type CostOptions, type MonthlyBill } from './bill-engine'
import { aggregateHourly, monthlyDemand, type TouCalendar } from './tou'
import type { MonthUsage, Tariff } from './types'

export interface HourlyGridFlows {
  /** 8760 hourly kWh imported from the grid. */
  importKwh: ArrayLike<number>
  /** 8760 hourly kWh exported to the grid. */
  exportKwh: ArrayLike<number>
  /**
   * Sub-hourly import for maximum demand (4a `subHourlyImport`): kWh per
   * interval over the reference year. When present it, not the hourly series,
   * sets maximum demand and peak-window demand (a meter integrates over 30 or
   * 15 minutes, so hourly averages understate demand).
   */
  subHourlyImport?: SubHourlyKwh
}

export interface SubHourlyKwh {
  /** Interval length; must divide a day (e.g. 30 or 15). */
  intervalMinutes: number
  /** 365 x 1440/intervalMinutes kWh values (29 Feb dropped). */
  kwh: ArrayLike<number>
}

export interface TariffMonthlySummary {
  month: number
  /** Total excl VAT, ZAR, after the export credit used. */
  totalZar: number
  /** Export credit used against this month's energy charges, ZAR (>= 0). */
  exportCreditUsedZar: number
}

export interface TariffBillCalculator {
  monthlyBills(flows: HourlyGridFlows): TariffMonthlySummary[]
}

/** Demand, NMD, amps and kVArh per month — not derivable from hourly kWh. */
export type MonthDemandInputs = Pick<MonthUsage, 'maxDemandKva' | 'maxDemandKw' | 'peakWindowMdKva' | 'nmdKva' | 'ampsRating' | 'kvarh'>

export interface HourlyCostOptions extends CostOptions {
  calendar: TouCalendar
  /** Reference year for day types (the 8760 year drops 29 Feb). */
  year: number
  holidays?: ReadonlySet<string>
  /** Explicit per-month inputs (NMD, amps, kVArh...); a value given here wins over the one derived from the series. */
  demandForMonth?: (month: number) => Partial<MonthDemandInputs>
  /** kVA = kW / powerFactor for demand derived from the import series. Default 1 (no reactive data). */
  powerFactor?: number
}

/**
 * Twelve bills (returned January..December) from separate hourly import and
 * export series. Net-billing credit is settled in the distributor's financial
 * year: with an SSEG rule the twelve months are costed from the month after
 * `fyEndMonth` (April for Eskom, July for municipal), so a balance carried out
 * of December reaches January-March instead of being dropped, and is forfeited
 * only at the financial-year end (spec 02 §5.7).
 */
export function costHourly(tariff: Tariff, flows: HourlyGridFlows, opts: HourlyCostOptions): MonthlyBill[] {
  const { calendar, year, holidays, demandForMonth, powerFactor = 1, ...cost } = opts
  if (!(powerFactor > 0 && powerFactor <= 1)) throw new RangeError(`powerFactor ${powerFactor} must be in (0, 1]`)
  // Maximum demand and peak-window (peak + standard) demand from the import series: the
  // sub-hourly series when given, else hourly averages. Owner decision 2026-09-28: Eskom
  // network demand [R/kVA] is billed on peak-window demand.
  const demand = monthlyDemand({
    kwh: flows.subHourlyImport?.kwh ?? flows.importKwh,
    intervalMinutes: flows.subHourlyImport?.intervalMinutes ?? 60,
    calendar, year, holidays,
  })
  const months = aggregateHourly({ importKwh: flows.importKwh, exportKwh: flows.exportKwh, calendar, year, holidays })
    .map((m, k) => ({
      ...m,
      maxDemandKw: demand[k].maxKw,
      maxDemandKva: demand[k].maxKw / powerFactor,
      peakWindowMdKva: demand[k].peakWindowMaxKw / powerFactor,
      ...(demandForMonth ? demandForMonth(m.month) : {}),
    }))
  const fyEnd = cost.sseg?.fyEndMonth ?? 12
  const start = fyEnd % 12
  // The wrapped months sit in the next calendar year of the same financial year.
  const ordered = [...months.slice(start), ...months.slice(0, start).map((m) => ({ ...m, year: m.year + 1 }))]
  return costPeriod(tariff, ordered, cost)
    .map((b) => ({ ...b, year }))
    .sort((a, b) => a.month - b.month)
}

export const DEFAULT_REFERENCE_YEAR = 2025

export function createBillCalculator(
  tariff: Tariff,
  calendar: TouCalendar,
  holidays?: ReadonlySet<string>,
  opts: Omit<HourlyCostOptions, 'calendar' | 'holidays' | 'year'> & { year?: number } = {},
): TariffBillCalculator {
  return {
    monthlyBills(flows) {
      const bills = costHourly(tariff, flows, { ...opts, calendar, holidays, year: opts.year ?? DEFAULT_REFERENCE_YEAR })
      return bills.map((b) => ({ month: b.month, totalZar: b.totalExclVat, exportCreditUsedZar: b.credit.used }))
    },
  }
}
