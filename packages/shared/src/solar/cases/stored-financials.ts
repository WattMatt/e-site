/**
 * Run financials from a STORED run (functional spec §8: pure computation on stored energy results).
 * Mirrors the engine's runFinancials line for line — year-1 bills, runFinance, and the tornado with
 * the export rate RE-PRICED through `calc.withExportRateScaled(k)` — but takes the stored hourly
 * series instead of a CaseResult; stored-financials.test.ts proves the two are identical on the
 * same series.
 *
 * The BillCalculator is the engine seam; on the server build it with `tariffBillCalculator(tariff,
 * { calendar, referenceYear, … })` from `@esite/shared/solar-engine` (the load's reference year).
 */
import type { FinancialsResult, SubHourlyImports } from '../../services/solar/case'
import type { BillCalculator, GridFlows, Year1Bills } from '../../services/solar/finance/bill-calculator'
import { runFinance, type FinanceInput } from '../../services/solar/finance/cashflow'
import { tornado } from '../../services/solar/finance/sensitivity'
import { ENGINE_VERSION } from '../../services/solar/version'
import { HOURS_PER_YEAR } from '../../services/solar/time'
import type { HourlySeries } from './hourly-csv'

export interface StoredEnergy {
  hourly: HourlySeries
  year1PvKwh: number
  year1DeliveredKwh: number
  /**
   * Sub-hourly imports for maximum demand, when the run had measured sub-hourly load. The stored
   * hourly CSV does not carry them; without them MD is priced on the hourly series (as the engine
   * does for a case with no sub-hourly load).
   */
  subHourly?: SubHourlyImports
  /**
   * `false` when the run's input said export earns no credit (CaseInput.export.credited — study
   * "Yes (no credit)" or the case override). The after-bills are then priced with zero export, so no
   * export credit reaches year-1 savings or the export-rate sensitivity. Absent/true = credited.
   */
  exportCredited?: boolean
}

function annual(calc: BillCalculator, flows: GridFlows): { total: number; credit: number } {
  const bills = calc.monthlyBills(flows)
  if (bills.length !== 12) throw new Error(`BillCalculator must return 12 monthly bills, got ${bills.length}`)
  let total = 0
  let credit = 0
  for (const b of bills) {
    if (!Number.isFinite(b.totalZar) || !Number.isFinite(b.exportCreditUsedZar) || b.exportCreditUsedZar < 0) {
      throw new Error(`BillCalculator returned an invalid bill for month ${b.month}`)
    }
    total += b.totalZar
    credit += b.exportCreditUsedZar
  }
  return { total, credit }
}

function storedYear1Bills(calc: BillCalculator, e: StoredEnergy): Year1Bills {
  const h = e.hourly
  const sub = e.subHourly
  const zero = new Float64Array(h.load.length)
  const credited = e.exportCredited !== false
  const before = annual(calc, { importKwh: h.load, exportKwh: zero, subHourlyImport: sub?.before })
  const after = annual(calc, { importKwh: h.import, exportKwh: credited ? h.export : zero, subHourlyImport: sub?.after })
  const afterPv = annual(calc, { importKwh: h.importPvOnly, exportKwh: credited ? h.exportPvOnly : zero, subHourlyImport: sub?.afterPvOnly })
  return { beforeZar: before.total, afterZar: after.total, afterPvOnlyZar: afterPv.total, exportCreditUsedZar: after.credit }
}

export function runStoredFinancials(e: StoredEnergy, fin: FinanceInput, calc: BillCalculator): FinancialsResult {
  if (e.hourly.load.length !== HOURS_PER_YEAR) throw new Error('stored hourly series is not on the 8760 time base')
  const y1 = storedYear1Bills(calc, e)
  const energy = { year1PvKwh: e.year1PvKwh, year1DeliveredKwh: e.year1DeliveredKwh, bills: y1 }
  const finance = runFinance(fin, energy)
  const firstView = finance.models[0]!.views[0]!.view
  const exportRateBills = (k: number) => storedYear1Bills(calc.withExportRateScaled(k), e)
  return { engineVersion: ENGINE_VERSION, year1Bills: y1, finance, tornado: tornado(fin, energy, 0, firstView, undefined, { exportRateBills }) }
}
