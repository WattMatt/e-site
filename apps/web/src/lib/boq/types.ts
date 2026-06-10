import type { QuantityMode, RateModel, SectionKind } from '@esite/shared'

// Raw spreadsheet data: array-of-arrays
export type Aoa = (string | number | null)[][]

// Maps logical field names to 0-based column indices
export interface ColumnMap {
  item?: number
  description?: number
  unit?: number
  qty?: number
  supply?: number
  install?: number
  rate?: number
  amount?: number
}

// Result of classifySheet()
export interface SheetClassification {
  kind: 'bill' | 'summary' | 'prose'
  headerRowIndex: number
  columns: ColumnMap
  rateModel: RateModel
}

// A parsed section (category/bill/section row in the spreadsheet)
export interface ParsedSection {
  tempId: string
  parentTempId: string // tempId of the containing ParsedBill or parent ParsedSection
  kind: SectionKind
  code: string | null
  title: string
  sortOrder: number
}

// A priced row the parser could not classify as a category or item. Surfaced so
// a value is never silently dropped (e.g. the digit-led "10.1" Shoprite row).
export interface ParsedUnclassifiedRow {
  sheet: string
  rowIndex: number
  code: string
  description: string
  amount: number
}

// A parsed line item
export interface ParsedItem {
  sectionTempId: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  quantityMode: QuantityMode
  rateModel: RateModel
  supplyRate: number | null
  installRate: number | null
  rate: number | null
  amount: number | null
  sortOrder: number
}

// A parsed bill (one or more related sheets grouped together)
export interface ParsedBill {
  tempId: string
  code: string
  title: string
  expectedTotal: number | null
  sections: ParsedSection[]
  items: ParsedItem[]
}

// The full parsed BOQ from a workbook
export interface ParsedBoq {
  grandTotalExpected: number | null
  totalExVatExpected: number | null
  vatExpected: number | null
  totalInclVatExpected: number | null
  bills: ParsedBill[]
  skippedSheets: string[]
  unclassifiedRows: ParsedUnclassifiedRow[]
}

// Per-bill result from reconcile()
export interface BillReconcileResult {
  tempId: string
  code: string
  computed: number
  expected: number | null
  matched: boolean
}

// Result of reconcile()
export interface ReconciliationReport {
  grandTotalComputed: number
  grandTotalExpected: number | null
  matched: boolean
  billResults: BillReconcileResult[]
  warnings: string[]
  skippedSheets: string[]
}
