/**
 * Tender BOQ types (E5 slice A).
 *
 * The tender BOQ is stored ROW-FAITHFUL: one parsed row per meaningful sheet row,
 * carrying its sheet, its 1-based Excel row number and the column letters of its
 * rate and amount cells. That is what lets slice C prove an uploaded priced copy
 * changed no locked cell, and lets a tenderer see the BOQ exactly as issued.
 */

export type Cell = string | number | null
export type Aoa = Cell[][]

export type TenderRowKind = 'heading' | 'item' | 'note' | 'total'

/**
 * How a tenderer may fill an item's rate cell.
 * - priced:     a rate is required (amount = qty × rate)
 * - fixed:      WM sets the amount (provisional/PC sum, contingency); the tenderer cannot change it
 * - rate_only:  a rate is required but there is no quantity, so it carries no amount
 * - not_priced: the tenderer may leave it blank
 */
export type RateCellType = 'priced' | 'fixed' | 'rate_only' | 'not_priced'

export const RATE_CELL_TYPES: readonly RateCellType[] = ['priced', 'fixed', 'rate_only', 'not_priced']

export interface ColumnMap {
  item?: number
  description?: number
  unit?: number
  qty?: number
  rate?: number
  supply?: number
  install?: number
  amount?: number
}

export interface ParsedTenderRow {
  sheet: string
  /** 1-based Excel row number. */
  rowNumber: number
  kind: TenderRowKind
  /** Bill the row sits in: the sheet's bill code when one is recognised, else the sheet name. */
  billCode: string
  code: string | null
  description: string
  unit: string | null
  /** Numeric quantity. Null for headings, notes, totals and RATE ONLY items. */
  quantity: number | null
  /** Codes of the headings above this row, outermost first. */
  headingPath: string[]
  /** Items only. */
  rateCellType: RateCellType | null
  /** Rate value present in the source workbook (pre-priced estimate; usually null in a tender BOQ). */
  rate: number | null
  /** Amount value present in the source workbook. For `fixed` items this is the locked amount. */
  amount: number | null
  /** Column letters of the rate and amount cells (e.g. 'F', 'G'). */
  rateColumn: string | null
  amountColumn: string | null
}

export interface ParsedSheet {
  name: string
  billCode: string
  headerRowNumber: number
  columns: ColumnMap
  rows: ParsedTenderRow[]
  /** The sheet's own "TOTAL … CARRIED FORWARD" figure, if present. */
  statedTotal: number | null
}

export interface SummaryLine {
  /** Bill number as printed in the summary (e.g. '1', '2', 'A'). */
  code: string
  description: string
  amount: number
}

export interface ParsedSummary {
  sheet: string
  lines: SummaryLine[]
  subtotalExVat: number | null
  vat: number | null
  totalInclVat: number | null
}

/** A row that looked priced but could not be classified. Never dropped silently. */
export interface UnclassifiedRow {
  sheet: string
  rowNumber: number
  code: string
  description: string
  amount: number | null
  reason: string
}

export interface ParsedTenderWorkbook {
  sheets: ParsedSheet[]
  summary: ParsedSummary | null
  /** Sheets that had no recognisable header row, are hidden, or are a second summary. */
  skippedSheets: string[]
  /** Skipped sheets that hold numbers: possibly a bill the parser could not read. Fails reconciliation. */
  skippedPricedSheets: string[]
  unclassified: UnclassifiedRow[]
}

export interface CheckResult {
  label: string
  computed: number
  stated: number | null
  /** stated − computed, in cents. Null when nothing was stated. */
  differenceCents: number | null
  matched: boolean
}

export interface ArithmeticError {
  sheet: string
  rowNumber: number
  code: string | null
  quantity: number
  rate: number
  amount: number
  expected: number
}

export interface TenderReconciliation {
  /** True only when every stated figure matched to the cent and nothing was unclassified. */
  matched: boolean
  sheets: CheckResult[]
  summaryLines: CheckResult[]
  subtotal: CheckResult | null
  arithmeticErrors: ArithmeticError[]
  warnings: string[]
}

export type DiffChangeField = 'description' | 'unit' | 'quantity' | 'rateCellType'

export interface DiffChange {
  sheet: string
  code: string | null
  field: DiffChangeField
  before: string | number | null
  after: string | number | null
}

export interface DiffRowRef {
  sheet: string
  code: string | null
  description: string
}

export interface TenderBoqDiff {
  identical: boolean
  added: DiffRowRef[]
  removed: DiffRowRef[]
  changed: DiffChange[]
}
