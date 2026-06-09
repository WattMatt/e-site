import type { BillReconcileResult, ParsedBoq, ReconciliationReport } from './types'

const round2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100

const tolerance = (expected: number) => Math.max(1, Math.abs(expected) * 0.005)

/**
 * Sum each bill's STORED item amounts, roll them up to a grand total, and
 * compare each bill's stored sum to its expected total (from the Main Summary)
 * plus the grand total to the workbook's expected ex-VAT grand total.
 *
 * The stored `amount` is the authoritative per-row source value the workbook
 * already carried — it is correct for every row type (measured, lump-sum,
 * allowance, PC, provisional, rate-only). Recomputing qty×rate here would yield
 * null/0 for the non-measured rows and lose their value, so we sum the stored
 * amounts directly (null → 0). Rate EDITS are recomputed elsewhere
 * (`boq.service.ts` / `RateCell`); this reconcile is a source-fidelity check.
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
      computed += item.amount ?? 0
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
