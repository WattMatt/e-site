import ExcelJS from 'exceljs'

/**
 * Turn the workbook WM imported into the copy a bidder may download.
 *
 * The imported workbook can be WM's PRE-PRICED internal estimate (slice A
 * stores its rates as tender_estimate_lines), so a bidder's copy must carry
 * none of WM's figures and nothing that could rebuild them. Rather than
 * guessing which columns hold prices (a sheet may carry SUPPLY and INSTALL
 * rates, or workings beside the BOQ), it keeps the LOCKED columns and clears
 * every other figure:
 *   - hidden and very-hidden sheets are removed;
 *   - every formula is replaced by its value; comments, defined names, data
 *     validation, conditional formats, headers/footers and document properties
 *     are dropped;
 *   - on a BOQ sheet, the locked columns (item code, description, unit,
 *     quantity: the ones the round-trip compares) are found from the stored
 *     items. A number survives only in a locked column on a stored item or
 *     heading row, or as the amount of a fixed sum (provisional sums and PC are
 *     WM's, issued to all); every other number is cleared, so a total or a
 *     build-up figure sitting in the QTY column of some other row goes too.
 *     Hidden ITEM rows are shown (the round-trip needs them); any other hidden
 *     row is emptied;
 *   - on any other sheet (notes, summaries) numbers are cleared and words kept,
 *     and hidden rows and columns are emptied.
 */
export interface BidderWorkbookItem {
  sheet_name: string
  row_number: number
  kind: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  rate_cell_type: string | null
  rate_column: string | null
  amount_column: string | null
}

type CellValue = ExcelJS.CellValue

function plainValue(cell: ExcelJS.Cell): CellValue {
  if (cell.type !== ExcelJS.ValueType.Formula) return cell.value
  const r = cell.result as unknown
  if (r == null || (typeof r === 'object' && !(r instanceof Date))) return null
  return r as CellValue
}

/** A number, or text that reads as one ("1 234,50", "R 1 234 567", "15 %"). */
export function isNumberLike(v: CellValue): boolean {
  if (typeof v === 'number') return true
  if (v instanceof Date) return false
  if (typeof v !== 'string') return false
  return /^\s*(R\s*)?[-+]?[\d\s,.]*\d[\d\s,.]*\s*%?\s*$/i.test(v)
}

const sameText = (a: unknown, b: string | null) =>
  b != null && a != null && String(a).trim().toLowerCase() === b.trim().toLowerCase()
/** Equal within the 4 decimals a quantity is stored to. */
const sameNumber = (a: unknown, b: string | number | null) =>
  b != null && a != null && a !== '' && Number.isFinite(Number(a)) && Number.isFinite(Number(b)) && Math.abs(Number(a) - Number(b)) < 0.00005

const FIELDS = ['code', 'description', 'unit', 'quantity'] as const
function matches(field: (typeof FIELDS)[number], v: CellValue, it: BidderWorkbookItem): boolean {
  if (field === 'code') return sameText(v, it.code) || sameNumber(v, it.code)
  if (field === 'description') return sameText(v, it.description)
  if (field === 'unit') return sameText(v, it.unit)
  return sameNumber(v, it.quantity)
}

/**
 * Columns (by number) that hold a locked field for at least half of the items
 * that HAVE that field (a sheet of mostly rate-only items still finds its QTY
 * column). The stored rate and amount columns are never locked.
 */
function lockedColumns(ws: ExcelJS.Worksheet, items: BidderWorkbookItem[]): Set<number> {
  const priceCols = new Set(
    items.flatMap((i) => [i.rate_column, i.amount_column]).filter((c): c is string => !!c).map((c) => ws.getColumn(c).number),
  )
  const locked = new Set<number>()
  for (const field of FIELDS) {
    const having = items.filter((it) => it[field] != null && String(it[field]).trim() !== '')
    if (having.length === 0) continue
    const hits = new Map<number, number>()
    for (const it of having) {
      ws.getRow(it.row_number).eachCell({ includeEmpty: false }, (cell) => {
        if (matches(field, plainValue(cell), it)) hits.set(Number(cell.col), (hits.get(Number(cell.col)) ?? 0) + 1)
      })
    }
    for (const [c, n] of hits) if (n * 2 >= having.length && !priceCols.has(c)) locked.add(c)
  }
  return locked
}

export function sanitiseWorkbookForBidder(wb: ExcelJS.Workbook, items: BidderWorkbookItem[]): { removedSheets: string[] } {
  const bySheet = new Map<string, BidderWorkbookItem[]>()
  const keepRows = new Map<string, Set<number>>() // stored item and heading rows
  const itemRows = new Map<string, Set<number>>()
  for (const i of items) {
    if (i.kind === 'item' || i.kind === 'heading') {
      if (!keepRows.has(i.sheet_name)) keepRows.set(i.sheet_name, new Set())
      keepRows.get(i.sheet_name)!.add(i.row_number)
    }
    if (i.kind !== 'item') continue
    if (!itemRows.has(i.sheet_name)) itemRows.set(i.sheet_name, new Set())
    itemRows.get(i.sheet_name)!.add(i.row_number)
    const list = bySheet.get(i.sheet_name) ?? []
    list.push(i)
    bySheet.set(i.sheet_name, list)
  }

  const removedSheets: string[] = []
  for (const ws of [...wb.worksheets]) {
    if (ws.state && ws.state !== 'visible') {
      removedSheets.push(ws.name)
      wb.removeWorksheet(ws.id)
    }
  }
  wb.definedNames.model = []
  wb.creator = 'E-Site'
  wb.lastModifiedBy = 'E-Site'
  for (const k of ['title', 'subject', 'keywords', 'category', 'description', 'company', 'manager'] as const) {
    ;(wb as unknown as Record<string, unknown>)[k] = ''
  }

  for (const ws of wb.worksheets) {
    const its = bySheet.get(ws.name)
    ;(ws as unknown as { dataValidations: { model: Record<string, unknown> } }).dataValidations.model = {}
    ;(ws as unknown as { conditionalFormattings: unknown[] }).conditionalFormattings = []
    ws.headerFooter = { differentFirst: false, differentOddEven: false, oddHeader: '', oddFooter: '', evenHeader: '', evenFooter: '', firstHeader: '', firstFooter: '' }

    const locked = its ? lockedColumns(ws, its) : new Set<number>()
    const fixedAmount = new Set(
      (its ?? []).filter((i) => i.rate_cell_type === 'fixed' && i.amount_column).map((i) => `${i.amount_column}${i.row_number}`),
    )
    const keep = keepRows.get(ws.name) ?? new Set<number>()
    const shown = itemRows.get(ws.name) ?? new Set<number>()
    ws.eachRow({ includeEmpty: true }, (row) => {
      const hiddenRow = !!row.hidden && !shown.has(row.number)
      if (row.hidden && shown.has(row.number)) row.hidden = false
      row.eachCell({ includeEmpty: true }, (cell) => {
        const v = plainValue(cell)
        ;(cell as unknown as { _comment?: unknown })._comment = undefined
        const col = Number(cell.col)
        let out: CellValue = v
        if (hiddenRow || (ws.getColumn(col).hidden && !locked.has(col))) out = null // hidden rows and columns are emptied
        else if (!its) out = isNumberLike(v) ? null : v // notes and summaries: figures go, words stay
        else if (fixedAmount.has(cell.address)) out = v
        else if (isNumberLike(v) && !(locked.has(col) && keep.has(row.number))) out = null
        cell.value = out
      })
    })
  }
  return { removedSheets }
}
