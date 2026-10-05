import type { DiffRowRef, ParsedTenderWorkbook, RateCellType, TenderRowKind } from './types'

/** Insert shape for projects.tender_boq_items (tender_id is added by the caller). */
export interface TenderItemRow {
  sort_order: number
  sheet_name: string
  row_number: number
  kind: TenderRowKind
  bill_code: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  heading_path: string[]
  rate_cell_type: RateCellType | null
  fixed_amount: number | null
  stated_amount: number | null
  rate_column: string | null
  amount_column: string | null
}

const round = (x: number | null, dp: number) => (x == null ? null : Math.round(x * 10 ** dp) / 10 ** dp)

export function toItemRows(parsed: ParsedTenderWorkbook): TenderItemRow[] {
  const out: TenderItemRow[] = []
  for (const s of parsed.sheets) {
    for (const r of s.rows) {
      out.push({
        sort_order: out.length,
        sheet_name: r.sheet,
        row_number: r.rowNumber,
        kind: r.kind,
        bill_code: r.billCode,
        code: r.code,
        description: r.description,
        unit: r.unit,
        quantity: round(r.quantity, 4),
        heading_path: r.headingPath,
        rate_cell_type: r.kind === 'item' ? r.rateCellType : null,
        // A fixed row with no amount in the workbook stays NULL (never a silent R0):
        // the review grid asks WM to enter it before the tender can be issued.
        fixed_amount: r.kind === 'item' && r.rateCellType === 'fixed' ? round(r.amount, 2) : null,
        stated_amount: r.kind === 'total' ? round(r.amount, 2) : null,
        rate_column: r.kind === 'item' ? r.rateColumn : null,
        amount_column: r.kind === 'item' ? r.amountColumn : null,
      })
    }
  }
  return out
}

/** Estimate line keyed by the tender row's cell address (paired again in SQL). */
export interface EstimateLineRow {
  sheet_name: string
  row_number: number
  rate: number | null
  amount: number | null
}

/**
 * Pair the PRE-PRICED INTERNAL workbook's item rows with the tender's item rows
 * (sheet + code, with an occurrence counter so a repeated code is not collapsed)
 * and emit each estimate figure against the TENDER row's sheet and row number.
 * Estimate rows the tender does not contain are returned, not dropped.
 */
export function toEstimateLines(
  tenderRows: TenderItemRow[],
  estimate: ParsedTenderWorkbook,
): { lines: EstimateLineRow[]; unmatched: DiffRowRef[] } {
  const keyOf = (sheet: string, code: string | null, description: string, n: number) =>
    `${sheet}\u0000${code ?? `desc:${description.toUpperCase()}`}\u0000${n}`
  const byKey = new Map<string, TenderItemRow>()
  const seen = new Map<string, number>()
  for (const r of tenderRows) {
    if (r.kind !== 'item') continue
    const base = keyOf(r.sheet_name, r.code, r.description, 0)
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    byKey.set(keyOf(r.sheet_name, r.code, r.description, n), r)
  }
  const lines: EstimateLineRow[] = []
  const unmatched: DiffRowRef[] = []
  const seenE = new Map<string, number>()
  for (const s of estimate.sheets) {
    for (const r of s.rows) {
      if (r.kind !== 'item') continue
      const base = keyOf(r.sheet, r.code, r.description, 0)
      const n = (seenE.get(base) ?? 0) + 1
      seenE.set(base, n)
      const t = byKey.get(keyOf(r.sheet, r.code, r.description, n))
      if (!t) {
        unmatched.push({ sheet: r.sheet, code: r.code, description: r.description })
        continue
      }
      if (r.rate == null && r.amount == null) continue
      lines.push({ sheet_name: t.sheet_name, row_number: t.row_number, rate: round(r.rate, 4), amount: round(r.amount, 2) })
    }
  }
  return { lines, unmatched }
}
