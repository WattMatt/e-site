import ExcelJS from 'exceljs'
import { classifySheet } from './classify-sheet'
import { parseSheet } from './parse-sheet'
import type { Aoa, ParsedBill, ParsedBoq, ParsedItem, ParsedSection } from './types'

// ─── Cell / worksheet coercion ──────────────────────────────────────────────

/**
 * Coerce one ExcelJS cell value to a clean scalar.
 *
 * A cell value can be a formula/rich-text/hyperlink object, so prefer the
 * computed result, then the rendered text, then the raw value. Dates and
 * everything non-scalar collapse to a string; empty strings become null.
 */
function coerceCell(value: ExcelJS.CellValue | undefined): string | number | null {
  if (value == null) return null
  if (typeof value === 'number') return isNaN(value) ? null : value
  if (typeof value === 'string') {
    const t = value.trim()
    return t === '' ? null : t
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString()
  // Object form: formula result, shared formula, rich text, hyperlink, error.
  const obj = value as {
    result?: unknown
    text?: unknown
    richText?: { text?: string }[]
    hyperlink?: string
  }
  if (obj.result != null) return coerceCell(obj.result as ExcelJS.CellValue)
  if (Array.isArray(obj.richText)) {
    const t = obj.richText.map((r) => r.text ?? '').join('').trim()
    return t === '' ? null : t
  }
  if (typeof obj.text === 'string') {
    const t = obj.text.trim()
    return t === '' ? null : t
  }
  return null
}

/**
 * Convert an ExcelJS worksheet to a 0-indexed array-of-arrays.
 *
 * ExcelJS is 1-indexed: `getSheetValues()` returns a leading `null` element and
 * each row a leading `null` cell. We strip both so the result is a clean,
 * 0-indexed `(string|number|null)[][]` matching the `Aoa` the parser expects.
 */
function worksheetToAoa(ws: ExcelJS.Worksheet): Aoa {
  const raw = ws.getSheetValues() // [null, rowOrNull, rowOrNull, ...]
  const out: Aoa = []
  for (let r = 1; r < raw.length; r++) {
    const rowVals = raw[r] as ExcelJS.CellValue[] | undefined
    if (rowVals == null) {
      out.push([])
      continue
    }
    const row: (string | number | null)[] = []
    for (let c = 1; c < rowVals.length; c++) {
      row.push(coerceCell(rowVals[c]))
    }
    out.push(row)
  }
  return out
}

// ─── Main Summary parsing ───────────────────────────────────────────────────

interface SummaryEntry {
  itemNo: string // e.g. '1', '2'
  description: string
  amount: number
}

interface SummaryTotals {
  entries: SummaryEntry[]
  totalExVat: number | null
  vat: number | null
  totalInclVat: number | null
}

const toNum = (v: string | number | null): number | null => {
  if (v == null) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const n = Number(String(v).replace(/[, ]/g, ''))
  return isNaN(n) ? null : n
}

const toStr = (v: string | number | null): string => (v == null ? '' : String(v).trim())

// Last numeric cell in a row = the amount column (the summary has a single
// amount column, often with blank spacer cells before it).
function lastNumericInRow(row: (string | number | null)[]): number | null {
  for (let c = row.length - 1; c >= 0; c--) {
    const n = toNum(row[c])
    if (n != null) return n
  }
  return null
}

const ITEM_NO_RE = /^\d+$/ // a bill line in the Main Summary is numbered 1, 2, 3…

/**
 * Parse the Main Summary sheet into ordered bill entries plus the ex-VAT / VAT /
 * incl-VAT totals.
 *
 * Each numbered row (item = "1", "2", …) is a bill: description = bill title,
 * amount = last numeric cell. The three totals are matched by description text:
 *   - ex-VAT total:   /TOTAL.*EXCLUSIVE OF VAT/  (fallback: /SUB[- ]?TOTAL/)
 *   - VAT line:       a row whose description mentions VAT but not "exclusive"
 *   - incl-VAT total: /INCLUSIVE OF VAT/ (fallback: the largest total row)
 * If the VAT line is not identifiable, vat = inclVat − exVat (when both exist).
 */
function parseMainSummary(rows: Aoa): SummaryTotals {
  const entries: SummaryEntry[] = []
  let totalExVat: number | null = null
  let vat: number | null = null
  let totalInclVat: number | null = null

  for (const row of rows) {
    const itemNo = toStr(row[0])
    const desc = toStr(row[1])
    const amount = lastNumericInRow(row)
    if (amount == null) continue

    const upper = desc.toUpperCase()

    if (ITEM_NO_RE.test(itemNo) && desc !== '') {
      entries.push({ itemNo, description: desc, amount })
      continue
    }

    // Total / VAT lines (no numeric item number).
    if (/INCLUSIVE OF VAT/.test(upper)) {
      totalInclVat = amount
    } else if (/EXCLUSIVE OF VAT/.test(upper) || /\bSUB[- ]?TOTAL\b/.test(upper)) {
      totalExVat = amount
    } else if (/\bVAT\b/.test(upper)) {
      vat = amount
    }
  }

  // Derive a missing piece where we can.
  if (vat == null && totalInclVat != null && totalExVat != null) {
    vat = Math.round((totalInclVat - totalExVat + Number.EPSILON) * 100) / 100
  }
  if (totalExVat == null && totalInclVat != null && vat != null) {
    totalExVat = Math.round((totalInclVat - vat + Number.EPSILON) * 100) / 100
  }

  return { entries, totalExVat, vat, totalInclVat }
}

// ─── Sheet → bill grouping ──────────────────────────────────────────────────

const MALL_SHEET_RE = /^1\.\d/ // 1.2 Medium Voltage … 1.16 Day Works
const TENANT_SHEET_RE = /^\d+-\d+/ // 7-18 Shoprite, 2-5 Boxer

interface BillSheet {
  name: string
  sections: ParsedSection[]
  items: ParsedItem[]
}

// Normalise a name for fuzzy matching a tenant sheet to a summary description.
function normaliseName(s: string): string {
  return s
    .toUpperCase()
    .replace(/^[\d.\-\s]+/, '') // strip leading sheet-number prefix (e.g. "7-18 ")
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Find the summary entry that best matches a tenant sheet name.
 * Match on normalised-name containment in either direction; return null on no
 * confident match (the caller records a warning and leaves expectedTotal null).
 */
function matchSummaryEntry(sheetName: string, entries: SummaryEntry[]): SummaryEntry | null {
  const sheetNorm = normaliseName(sheetName)
  if (sheetNorm === '') return null
  // Prefer the longest matching description (most specific) to avoid e.g.
  // "Boxer" matching "Boxer Liquor".
  let best: SummaryEntry | null = null
  for (const e of entries) {
    const eNorm = normaliseName(e.description)
    if (eNorm === '') continue
    if (sheetNorm === eNorm || sheetNorm.includes(eNorm) || eNorm.includes(sheetNorm)) {
      if (best == null || normaliseName(e.description).length > normaliseName(best.description).length) {
        best = e
      }
    }
  }
  return best
}

// Order index from the summary (by itemNo); unknown bills sort last, stably.
function summaryOrder(entry: SummaryEntry | null): number {
  if (entry == null) return Number.MAX_SAFE_INTEGER
  const n = Number(entry.itemNo)
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Parse a priced BOQ workbook (.xlsx buffer) into a `ParsedBoq`:
 *   - classify each sheet (bill / summary / prose)
 *   - prose sheets → skippedSheets
 *   - the Main Summary drives bill order + expected totals + VAT
 *   - `1.x` sheets fold into one synthetic "MALL PORTION" bill (each sheet a
 *     section node); `N-NN Name` sheets each become their own tenant bill
 *
 * Pure aside from reading the workbook buffer; no network or DB.
 */
export async function parseBoqXlsx(buffer: Buffer): Promise<ParsedBoq> {
  const wb = new ExcelJS.Workbook()
  // ExcelJS declares its own global `interface Buffer extends ArrayBuffer`,
  // which clashes with Node's `Buffer` under newer @types/node (TS2345). A Node
  // Buffer is a valid input at runtime; cast at this single boundary.
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])

  const skippedSheets: string[] = []
  let summary: SummaryTotals = { entries: [], totalExVat: null, vat: null, totalInclVat: null }

  const mallSheets: BillSheet[] = []
  const tenantSheets: BillSheet[] = []
  // Bill sheets that are neither 1.x nor N-NN (e.g. a standalone "P&G").
  const otherBillSheets: BillSheet[] = []

  for (const ws of wb.worksheets) {
    const name = ws.name
    const rows = worksheetToAoa(ws)
    const cls = classifySheet(name, rows)

    if (cls.kind === 'prose') {
      skippedSheets.push(name)
      continue
    }
    if (cls.kind === 'summary') {
      // Use the Main Summary for the bill index; ignore sub-summaries (Mall
      // Summary) for Phase-1 reconciliation.
      if (/MAIN SUMMARY/i.test(name)) {
        summary = parseMainSummary(rows)
      }
      continue
    }

    // Bill sheet.
    const { sections, items } = parseSheet(name, rows, cls)
    const sheet: BillSheet = { name, sections, items }
    if (MALL_SHEET_RE.test(name)) mallSheets.push(sheet)
    else if (TENANT_SHEET_RE.test(name)) tenantSheets.push(sheet)
    else otherBillSheets.push(sheet)
  }

  const bills: ParsedBill[] = []

  // ── Synthetic MALL PORTION bill (only if any 1.x sheets exist) ─────────────
  if (mallSheets.length > 0) {
    const billRootTempId = 'bill#MALL_PORTION'
    const mallEntry =
      summary.entries.find((e) => e.itemNo === '1') ??
      summary.entries.find((e) => /MALL/i.test(e.description)) ??
      null

    const sections: ParsedSection[] = []
    const items: ParsedItem[] = []
    let sectionSort = 0

    for (const sheet of mallSheets) {
      // Each 1.x sheet becomes a section node under the MALL bill root.
      const sheetNodeTempId = `section#${sheet.name}`
      sections.push({
        tempId: sheetNodeTempId,
        parentTempId: billRootTempId,
        kind: 'section',
        code: null,
        title: sheet.name,
        sortOrder: sectionSort++,
      })
      // That sheet's category sections hang off this section node.
      for (const sec of sheet.sections) {
        sections.push({ ...sec, parentTempId: sheetNodeTempId, sortOrder: sectionSort++ })
      }
      // Items keep their own sectionTempId (the category they were parsed under).
      items.push(...sheet.items)
    }

    bills.push({
      tempId: billRootTempId,
      code: mallEntry?.itemNo ?? 'MALL',
      title: mallEntry?.description ?? 'MALL PORTION',
      expectedTotal: mallEntry?.amount ?? null,
      sections,
      items,
    })
  }

  // ── Tenant bills (one per N-NN sheet) ──────────────────────────────────────
  const tenantBills: { bill: ParsedBill; order: number }[] = []
  for (const sheet of tenantSheets) {
    const billRootTempId = `bill#${sheet.name}`
    const entry = matchSummaryEntry(sheet.name, summary.entries)

    const sections: ParsedSection[] = [
      {
        tempId: billRootTempId,
        parentTempId: '',
        kind: 'bill',
        code: entry?.itemNo ?? null,
        title: entry?.description ?? sheet.name,
        sortOrder: 0,
      },
      // Each category from the sheet hangs directly off the bill root.
      ...sheet.sections.map((sec) => ({ ...sec, parentTempId: billRootTempId })),
    ]

    tenantBills.push({
      order: summaryOrder(entry),
      bill: {
        tempId: billRootTempId,
        code: entry?.itemNo ?? sheet.name,
        title: entry?.description ?? sheet.name,
        expectedTotal: entry?.amount ?? null,
        sections,
        items: sheet.items,
      },
    })
  }

  // Any uncategorised bill sheets become standalone bills too.
  for (const sheet of otherBillSheets) {
    const billRootTempId = `bill#${sheet.name}`
    const entry = matchSummaryEntry(sheet.name, summary.entries)
    const sections: ParsedSection[] = [
      {
        tempId: billRootTempId,
        parentTempId: '',
        kind: 'bill',
        code: entry?.itemNo ?? null,
        title: entry?.description ?? sheet.name,
        sortOrder: 0,
      },
      ...sheet.sections.map((sec) => ({ ...sec, parentTempId: billRootTempId })),
    ]
    tenantBills.push({
      order: summaryOrder(entry),
      bill: {
        tempId: billRootTempId,
        code: entry?.itemNo ?? sheet.name,
        title: entry?.description ?? sheet.name,
        expectedTotal: entry?.amount ?? null,
        sections,
        items: sheet.items,
      },
    })
  }

  // Order tenant/other bills by their Main Summary position; ties keep input order.
  tenantBills
    .sort((a, b) => a.order - b.order)
    .forEach(({ bill }) => bills.push(bill))

  return {
    grandTotalExpected: summary.totalExVat,
    totalExVatExpected: summary.totalExVat,
    vatExpected: summary.vat,
    totalInclVatExpected: summary.totalInclVat,
    bills,
    skippedSheets,
  }
}
