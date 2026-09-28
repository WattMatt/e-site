/**
 * The seam between the financial model (this phase, 4a) and the bill engine (Phase 2a).
 *
 * The finance model never looks inside a tariff. It asks a BillCalculator for twelve monthly
 * bills given one year of hourly grid flows, and uses only the totals and the export credit
 * USED (spec §5.7: carried credit is neither lost within a year nor treated as cash).
 * Phase 2a supplies the real implementation; until then tests use a stub.
 */
import { assert8760 } from '../time'
import type { EnergyBalance } from '../energy/energy-balance'
import type { SubHourlyLoad } from '../energy/max-demand'

export interface GridFlows {
  /** kWh imported from the grid per hour. */
  importKwh: Float64Array
  /** kWh exported per hour. */
  exportKwh: Float64Array
  /** Sub-hourly import for maximum demand, when measured data exists. */
  subHourlyImport?: SubHourlyLoad
}

export interface MonthlyBillSummary {
  month: number
  /** Total bill excl. VAT, ZAR, AFTER export credit used. */
  totalZar: number
  /** Export credit used against this month's energy charges, ZAR (≥ 0). */
  exportCreditUsedZar: number
}

export interface BillCalculator {
  /** Twelve monthly bills (Jan…Dec) at the base (year-1) tariff. */
  monthlyBills(flows: GridFlows): MonthlyBillSummary[]
}

export interface Year1Bills {
  /** Bill with no PV (the load imported in full). */
  beforeZar: number
  /** Bill with PV and battery. */
  afterZar: number
  /** Bill with PV only — isolates the battery's share of the saving so capacity fade applies to it alone. */
  afterPvOnlyZar: number
  /** Export credit used in the after-bill, ZAR (sensitivity on export rate). */
  exportCreditUsedZar: number
}

function annual(bills: MonthlyBillSummary[]): { total: number; credit: number } {
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

export function year1Bills(
  calc: BillCalculator,
  withBattery: EnergyBalance,
  pvOnly: EnergyBalance,
  sub?: { before?: SubHourlyLoad; after?: SubHourlyLoad; afterPvOnly?: SubHourlyLoad },
): Year1Bills {
  assert8760(withBattery.load, 'load')
  const zero = new Float64Array(withBattery.load.length)
  const before = annual(calc.monthlyBills({ importKwh: withBattery.load, exportKwh: zero, subHourlyImport: sub?.before }))
  const after = annual(calc.monthlyBills({ importKwh: withBattery.import, exportKwh: withBattery.export, subHourlyImport: sub?.after }))
  const afterPv = annual(calc.monthlyBills({ importKwh: pvOnly.import, exportKwh: pvOnly.export, subHourlyImport: sub?.afterPvOnly }))
  return { beforeZar: before.total, afterZar: after.total, afterPvOnlyZar: afterPv.total, exportCreditUsedZar: after.credit }
}
