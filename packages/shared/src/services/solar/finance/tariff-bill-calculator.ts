/**
 * Integration glue: drive the finance model (4a `BillCalculator`) with a real tariff priced by the
 * Phase 2a bill engine (`tariffs/bill-calculator`).
 *
 * WHY IT LIVES HERE (solar engine → tariffs), not in `tariffs/`: `tariffs` is re-exported from the
 * `@esite/shared` root barrel and is pure; the solar engine is deliberately NOT on the root barrel
 * (`services/solar/index.ts`). Putting the adapter in `tariffs` would make the root barrel pull the
 * engine's types in and create a tariffs ↔ solar edge. Here the dependency runs one way only —
 * the engine already owns the seam (`finance/bill-calculator.ts`) and nothing in `tariffs` imports
 * back. Deep module imports (not the tariffs barrel) keep parsers/ingest out of the engine bundle.
 *
 * The two seams are almost structurally identical; the one real difference is sub-hourly import:
 *   4a `SubHourlyLoad` = { intervalMin, kw: average kW per interval }
 *   2a `SubHourlyKwh`  = { intervalMinutes, kwh: kWh per interval }
 * Passed through unconverted, 2a reads `subHourlyImport.kwh` as undefined and SILENTLY falls back
 * to hourly averages for maximum demand — understating every demand charge. `toSubHourlyKwh`
 * converts it (kWh = kW × interval / 60).
 */
import { createBillCalculator, type HourlyCostOptions, type SubHourlyKwh } from '../../../tariffs/bill-calculator'
import type { TouCalendar } from '../../../tariffs/tou'
import type { Tariff } from '../../../tariffs/types'
import { listHolidays } from '../../../lib/jbcc/sa-public-holidays'
import { HOURS_PER_YEAR } from '../time'
import type { SubHourlyLoad } from '../energy/max-demand'
import type { BillCalculator } from './bill-calculator'

export function toSubHourlyKwh(sub: SubHourlyLoad): SubHourlyKwh {
  const perHour = 60 / sub.intervalMin
  const expected = HOURS_PER_YEAR * perHour
  if (sub.kw.length !== expected) {
    throw new RangeError(`sub-hourly load at ${sub.intervalMin} min must have ${expected} values, got ${sub.kw.length}`)
  }
  const f = sub.intervalMin / 60
  return { intervalMinutes: sub.intervalMin, kwh: Float64Array.from(sub.kw, (v) => v * f) }
}

/**
 * SA public holidays of `year` as the `YYYY-MM-DD` keys `TouCalendar` day typing reads.
 * `listHolidays` returns UTC-midnight dates, so the ISO date prefix IS the local date.
 */
export function referenceYearHolidays(year: number): ReadonlySet<string> {
  return new Set(listHolidays(year).map((d) => d.toISOString().slice(0, 10)))
}

export interface TariffBillCalculatorOptions extends Omit<HourlyCostOptions, 'calendar' | 'holidays' | 'year'> {
  calendar: TouCalendar
  /**
   * Calendar year whose weekdays and holidays the 8760 load was aligned to. TOU periods are
   * assigned on this year's day types, so it MUST be the load's year: take it from the
   * `SiteLoadForCase` that `caseLoadFromSiteSeries` returns, never type it again (a one-year slip
   * moves every weekday by one and misprices the TOU split without any error).
   */
  referenceYear: number
  /** Defaults to the statutory SA public holidays of `referenceYear`. */
  holidays?: ReadonlySet<string>
}

export function tariffBillCalculator(tariff: Tariff, opts: TariffBillCalculatorOptions): BillCalculator {
  const { calendar, referenceYear, holidays, ...cost } = opts
  const inner = createBillCalculator(tariff, calendar, holidays ?? referenceYearHolidays(referenceYear), { ...cost, year: referenceYear })
  return {
    monthlyBills(flows) {
      return inner.monthlyBills({
        importKwh: flows.importKwh,
        exportKwh: flows.exportKwh,
        subHourlyImport: flows.subHourlyImport ? toSubHourlyKwh(flows.subHourlyImport) : undefined,
      })
    },
  }
}
