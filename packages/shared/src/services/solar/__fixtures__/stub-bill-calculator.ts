/**
 * TEST STUB for the Phase 2a bill engine. A flat R 2.00/kWh import tariff, a fixed R 500/month
 * charge, and export credited at R 1.00/kWh against that month's ENERGY charge only (the NERSA
 * net-billing cap shape, spec §5.7) — enough structure for the finance model's tests, nothing more.
 * Replace with the real `costBill` adapter when Phase 2a lands.
 */
import { monthHourRanges } from '../time'
import { assertExportRateFactor, type BillCalculator, type GridFlows, type MonthlyBillSummary } from '../finance/bill-calculator'

export const STUB_IMPORT_RATE = 2
export const STUB_EXPORT_RATE = 1
export const STUB_FIXED_PER_MONTH = 500

function stubAt(exportRate: number): BillCalculator {
  return {
    monthlyBills(flows: GridFlows): MonthlyBillSummary[] {
      return monthHourRanges().map(({ month, start, end }) => {
        let imp = 0
        let exp = 0
        for (let h = start; h < end; h++) {
          imp += flows.importKwh[h]!
          exp += flows.exportKwh[h]!
        }
        const energy = imp * STUB_IMPORT_RATE
        const credit = Math.min(exp * exportRate, energy)
        return { month, totalZar: STUB_FIXED_PER_MONTH + energy - credit, exportCreditUsedZar: credit }
      })
    },
    withExportRateScaled(k: number): BillCalculator {
      assertExportRateFactor(k)
      return stubAt(exportRate * k)
    },
  }
}

export const stubBillCalculator: BillCalculator = stubAt(STUB_EXPORT_RATE)
