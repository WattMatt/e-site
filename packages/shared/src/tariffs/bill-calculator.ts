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
import { aggregateHourly, type TouCalendar } from './tou'
import type { MonthUsage, Tariff } from './types'

export interface HourlyGridFlows {
  /** 8760 hourly kWh imported from the grid. */
  importKwh: ArrayLike<number>
  /** 8760 hourly kWh exported to the grid. */
  exportKwh: ArrayLike<number>
  /**
   * Sub-hourly import for maximum demand (4a `subHourlyImport`). Accepted for
   * shape compatibility; demand is taken from `demandForMonth` for now.
   */
  subHourlyImport?: unknown
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
  demandForMonth?: (month: number) => Partial<MonthDemandInputs>
}

/**
 * Twelve bills (returned January..December) from separate hourly import and
 * export series. Net-billing credit is settled in the distributor's financial
 * year: with an SSEG rule the twelve months are costed from the month after
 * `fyEndMonth` (April for Eskom, July for municipal), so a balance carried out
 * of December reaches January-March instead of being dropped, and is forfeited
 * only at the financial-year end (spec 02 §5.7).
 */
export function costHourly(tariff: Tariff, flows: Pick<HourlyGridFlows, 'importKwh' | 'exportKwh'>, opts: HourlyCostOptions): MonthlyBill[] {
  const { calendar, year, holidays, demandForMonth, ...cost } = opts
  const months = aggregateHourly({ importKwh: flows.importKwh, exportKwh: flows.exportKwh, calendar, year, holidays })
    .map((m) => ({ ...m, ...(demandForMonth ? demandForMonth(m.month) : {}) }))
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
