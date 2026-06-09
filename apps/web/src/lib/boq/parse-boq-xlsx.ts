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
 * amount = last numeric cell.
 *
 * The ex-VAT total row IS labeled (/TOTAL.*EXCLUSIVE OF VAT/, fallback
 * /SUB[- ]?TOTAL/). The VAT and incl-VAT rows that follow are UNLABELED in the
 * real file (just a value in the amount column), so they cannot be matched by
 * text. Instead, the incl-VAT total = the LAST numeric value present anywhere in
 * the summary (the running total ends on the incl-VAT line), and
 * vat = inclVat − exVat when both are present.
 */
function parseMainSummary(rows: Aoa): SummaryTotals {
  const entries: SummaryEntry[] = []
  let totalExVat: number | null = null
  let lastNumeric: number | null = null

  for (const row of rows) {
    const itemNo = toStr(row[0])
    const desc = toStr(row[1])
    const amount = lastNumericInRow(row)
    if (amount == null) continue

    // The last numeric value anywhere in the summary is the incl-VAT total
    // (the unlabeled tail row r45 in the real file).
    lastNumeric = amount

    const upper = desc.toUpperCase()

    if (ITEM_NO_RE.test(itemNo) && desc !== '') {
      entries.push({ itemNo, description: desc, amount })
      continue
    }

    // Only the ex-VAT total is reliably labeled; VAT / incl-VAT rows are blank.
    if (/EXCLUSIVE OF VAT/.test(upper) || /\bSUB[- ]?TOTAL\b/.test(upper)) {
      totalExVat = amount
    }
  }

  const totalInclVat = lastNumeric
  let vat: number | null = null
  if (totalInclVat != null && totalExVat != null) {
    vat = Math.round((totalInclVat - totalExVat + Number.EPSILON) * 100) / 100
  }

  return { entries, totalExVat, vat, totalInclVat }
}

// ─── Sheet → bill grouping ──────────────────────────────────────────────────

// A tenant sheet is named `<summaryItemNo>-<shopNo> <Name>` (e.g. "2-5 Boxer",
// "7-18 Shoprite"). Every OTHER bill sheet (P&G, 1.2 … 1.16, any non-tenant
// non-summary non-prose sheet) is part of the Mall portion.
const TENANT_SHEET_RE = /^(\d+)-\d+/

interface BillSheet {
  name: string
  sections: ParsedSection[]
  items: ParsedItem[]
}

/**
 * A tenant sheet's Main-Summary item number is the LEADING number of its name
 * (the part before the first '-'): "2-5 Boxer" → "2", "7-18 Shoprite" → "7".
 */
function tenantLeadingItemNo(sheetName: string): string | null {
  const m = TENANT_SHEET_RE.exec(sheetName)
  return m ? m[1] : null
}

/**
 * Match a tenant sheet to its summary entry DETERMINISTICALLY by leading number.
 * Returns null if no summary entry has that itemNo (caller leaves expectedTotal
 * null, which surfaces as a reconcile warning — fail loud, no fuzzy fallback).
 */
function matchTenantSummaryEntry(sheetName: string, entries: SummaryEntry[]): SummaryEntry | null {
  const itemNo = tenantLeadingItemNo(sheetName)
  if (itemNo == null) return null
  return entries.find((e) => e.itemNo === itemNo) ?? null
}

// Order index from a tenant sheet's leading number; unknown bills sort last.
function tenantOrder(sheetName: string): number {
  const itemNo = tenantLeadingItemNo(sheetName)
  if (itemNo == null) return Number.MAX_SAFE_INTEGER
  const n = Number(itemNo)
  return isNaN(n) ? Number.MAX_SAFE_INTEGER : n
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Parse a priced BOQ workbook (.xlsx buffer) into a `ParsedBoq`:
 *   - classify each sheet (bill / summary / prose)
 *   - prose sheets → skippedSheets
 *   - the Main Summary drives bill order + expected totals + VAT
 *   - every NON-tenant bill sheet (P&G, `1.x`, …) folds into one synthetic
 *     "MALL PORTION" bill (each sheet a section node); `N-NN Name` sheets each
 *     become their own tenant bill, matched to the summary by leading number
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

  // Every non-tenant bill sheet (P&G, 1.x, …) belongs to the Mall portion.
  const mallSheets: BillSheet[] = []
  const tenantSheets: BillSheet[] = []

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

    // Bill sheet: tenant (N-NN) or part of the Mall portion (everything else).
    const { sections, items } = parseSheet(name, rows, cls)
    const sheet: BillSheet = { name, sections, items }
    if (TENANT_SHEET_RE.test(name)) tenantSheets.push(sheet)
    else mallSheets.push(sheet)
  }

  const bills: ParsedBill[] = []

  // ── Synthetic MALL PORTION bill (all non-tenant bill sheets) ───────────────
  if (mallSheets.length > 0) {
    const billRootTempId = 'bill#MALL_PORTION'
    const mallEntry =
      summary.entries.find((e) => e.itemNo === '1') ??
      summary.entries.find((e) => /MALL/i.test(e.description)) ??
      null

    // Bill-root section row — matches tenant/other bills so EVERY bill's sections[]
    // contains its own kind:'bill' root. Without this, MALL's section nodes
    // reference a parentTempId ('bill#MALL_PORTION') that has no section row,
    // and persistImport would orphan them (parent_section_id=null).
    const sections: ParsedSection[] = [
      {
        tempId: billRootTempId,
        parentTempId: '',
        kind: 'bill',
        code: mallEntry?.itemNo ?? null,
        title: mallEntry?.description ?? 'MALL PORTION',
        sortOrder: 0,
      },
    ]
    const items: ParsedItem[] = []
    let sectionSort = 1

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
  // Each tenant matches its summary entry DETERMINISTICALLY by the sheet name's
  // leading number (the summary item number). No fuzzy name matching — that
  // swapped e.g. Boxer ↔ Boxer Liquor and Shoprite ↔ Shoprite Liquor.
  const tenantBills: { bill: ParsedBill; order: number }[] = []
  for (const sheet of tenantSheets) {
    const billRootTempId = `bill#${sheet.name}`
    const entry = matchTenantSummaryEntry(sheet.name, summary.entries)

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
      order: tenantOrder(sheet.name),
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

  // Order tenant bills by their Main Summary position; ties keep input order.
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
