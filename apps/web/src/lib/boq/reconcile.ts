import { computeItemAmount } from '@esite/shared'
import type { BillReconcileResult, ParsedBoq, ParsedItem, ReconciliationReport } from './types'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

/**
 * Recompute one parsed item's amount using the shared write-time rule.
 *
 * `computeItemAmount` is typed for the DB `BoqItem` shape, but it only reads
 * the rate/quantity fields that `ParsedItem` also carries. Adapt the parsed
 * item into the minimal shape the rule needs so there is a single source of
 * truth for the amount calculation.
 */
function recomputeAmount(item: ParsedItem): number | null {
  return computeItemAmount({
    // identity fields are unused by the rule; supply stable stubs
    id: '00000000-0000-0000-0000-000000000000',
    sectionId: '00000000-0000-0000-0000-000000000000',
    code: item.code,
    description: item.description,
    unit: item.unit,
    quantity: item.quantity,
    quantityMode: item.quantityMode,
    rateModel: item.rateModel,
    supplyRate: item.supplyRate,
    installRate: item.installRate,
    rate: item.rate,
    amount: item.amount,
    sortOrder: item.sortOrder,
  })
}

const tolerance = (expected: number) => Math.max(1, Math.abs(expected) * 0.005)

/**
 * Recompute every item amount, roll the amounts up per bill, and compare each
 * bill's computed total to its expected total (from the Main Summary) plus the
 * grand total to the workbook's expected ex-VAT grand total.
 *
 * A bill (or grand total) with no expected value cannot be contradicted, so it
 * is treated as matched but a warning is recorded.
 *
 * Pure — no I/O. Tolerance per comparison: max(1, |expected| * 0.005).
 */
export function reconcile(parsed: ParsedBoq): ReconciliationReport {
  const warnings: string[] = []
  const billResults: BillReconcileResult[] = []
  let grandTotalComputed = 0

  for (const bill of parsed.bills) {
    let computed = 0
    for (const item of bill.items) {
      computed += recomputeAmount(item) ?? 0
    }
    computed = round2(computed)
    grandTotalComputed = round2(grandTotalComputed + computed)

    const expected = bill.expectedTotal
    let matched: boolean
    if (expected == null) {
      matched = true
      warnings.push(`Bill "${bill.code}" has no expected total from the summary; cannot reconcile.`)
    } else {
      matched = Math.abs(computed - expected) <= tolerance(expected)
      if (!matched) {
        warnings.push(
          `Bill "${bill.code}" computed ${computed} does not match expected ${expected}.`,
        )
      }
    }

    billResults.push({ tempId: bill.tempId, code: bill.code, computed, expected, matched })
  }

  const grandTotalExpected = parsed.grandTotalExpected
  let grandMatched: boolean
  if (grandTotalExpected == null) {
    grandMatched = true
    warnings.push('Workbook has no expected grand total; cannot reconcile the grand total.')
  } else {
    grandMatched =
      Math.abs(grandTotalComputed - grandTotalExpected) <= tolerance(grandTotalExpected)
    if (!grandMatched) {
      warnings.push(
        `Grand total computed ${grandTotalComputed} does not match expected ${grandTotalExpected}.`,
      )
    }
  }

  const matched = grandMatched && billResults.every((b) => b.matched)

  return {
    grandTotalComputed,
    grandTotalExpected,
    matched,
    billResults,
    warnings,
    skippedSheets: parsed.skippedSheets,
  }
}
