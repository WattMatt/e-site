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
        fixed_amount: r.kind === 'item' && r.rateCellType === 'fixed' ? round(r.amount ?? 0, 2) : null,
        stated_amount: r.kind === 'total' ? round(r.amount, 2) : null,
        rate_column: r.kind === 'item' ? r.rateColumn : null,
        amount_column: r.kind === 'item' ? r.amountColumn : null,
      })
    }
  }
  return out
}

const key = (sheet: string, code: string | null, description: string, n: number) =>
  `${sheet}\u0000${code ?? `desc:${description.toUpperCase()}`}\u0000${n}`

/**
 * Pair the PRE-PRICED INTERNAL workbook's item rows with the stored tender rows
 * (sheet + code, with an occurrence counter), returning estimate lines and any
 * estimate row the tender does not contain.
 */
export function toEstimateLines(
  tenderRows: (TenderItemRow & { id: string })[],
  estimate: ParsedTenderWorkbook,
): { lines: { item_id: string; rate: number | null; amount: number | null }[]; unmatched: DiffRowRef[] } {
  const byKey = new Map<string, string>()
  const seen = new Map<string, number>()
  for (const r of tenderRows) {
    if (r.kind !== 'item') continue
    const base = `${r.sheet_name}\u0000${r.code ?? r.description.toUpperCase()}`
    const n = (seen.get(base) ?? 0) + 1
    seen.set(base, n)
    byKey.set(key(r.sheet_name, r.code, r.description, n), r.id)
  }
  const lines: { item_id: string; rate: number | null; amount: number | null }[] = []
  const unmatched: DiffRowRef[] = []
  const seenE = new Map<string, number>()
  for (const s of estimate.sheets) {
    for (const r of s.rows) {
      if (r.kind !== 'item') continue
      const base = `${r.sheet}\u0000${r.code ?? r.description.toUpperCase()}`
      const n = (seenE.get(base) ?? 0) + 1
      seenE.set(base, n)
      const id = byKey.get(key(r.sheet, r.code, r.description, n))
      if (!id) {
        unmatched.push({ sheet: r.sheet, code: r.code, description: r.description })
        continue
      }
      if (r.rate == null && r.amount == null) continue
      lines.push({ item_id: id, rate: round(r.rate, 4), amount: round(r.amount, 2) })
    }
  }
  return { lines, unmatched }
}
