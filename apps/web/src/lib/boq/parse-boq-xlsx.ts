import ExcelJS from 'exceljs'
import { classifySheet } from './classify-sheet'
import { parseSheet } from './parse-sheet'
import type {
  Aoa,
  ParsedBill,
  ParsedBoq,
  ParsedItem,
  ParsedSection,
  ParsedUnclassifiedRow,
} from './types'

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
 * Normalise a sheet name or summary description for name-based matching.
 *
 * Steps: uppercase → strip leading `\d+-\d+` prefix (sheet numbering artefact)
 * → collapse every run of non-alphanumeric characters to a single space → trim.
 *
 * "20-60 The Fix"  → "THE FIX"
 * "THE FIX"        → "THE FIX"
 * "20-93 Cashbuild"→ "CASHBUILD"
 * "CASHBUILD"      → "CASHBUILD"
 */
function normaliseName(s: string): string {
  return s
    .toUpperCase()
    .replace(/^\d+-\d+\s*/, '')
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim()
}

/**
 * Match a set of tenant sheets to summary entries using a 3-step algorithm that
 * handles the case where two sheets carry the same leading number (one is
 * genuinely numbered, the other is mis-numbered in the source file):
 *
 * 1. **Primary (by number):** each sheet claims the summary entry whose
 *    `itemNo` equals the sheet's leading number.
 * 2. **Resolve collisions by name:** when two+ sheets claim the same entry,
 *    the sheet whose normalised name matches the entry's normalised description
 *    keeps it; the other sheet(s) become "unresolved".
 * 3. **Fallback for unresolved (by name):** each unresolved sheet is matched to
 *    a still-unclaimed entry via normalised-name containment (longest match wins).
 *    Still-unresolved sheets map to null (caller emits null expectedTotal).
 *
 * Returns a Map<sheetName, SummaryEntry | null>.
 */
function matchTenantSheets(
  sheetNames: string[],
  entries: SummaryEntry[],
): Map<string, SummaryEntry | null> {
  const result = new Map<string, SummaryEntry | null>()

  // Step 1: group sheets by their claimed itemNo.
  const byItemNo = new Map<string, string[]>() // itemNo → sheetNames
  for (const name of sheetNames) {
    const itemNo = tenantLeadingItemNo(name)
    if (itemNo == null) {
      result.set(name, null) // no leading number at all → unresolvable
      continue
    }
    const group = byItemNo.get(itemNo) ?? []
    group.push(name)
    byItemNo.set(itemNo, group)
  }

  // Track which entries have been claimed.
  const claimed = new Set<string>() // entry.itemNo values
  const unresolved: string[] = [] // sheet names to fall through to step 3

  // Step 2: assign or declare collision.
  for (const [itemNo, group] of byItemNo) {
    const entry = entries.find((e) => e.itemNo === itemNo) ?? null

    if (entry == null) {
      // No summary entry for this number — all sheets in group go to fallback.
      for (const name of group) unresolved.push(name)
      continue
    }

    if (group.length === 1) {
      // Unique claim — assign directly.
      result.set(group[0], entry)
      claimed.add(entry.itemNo)
      continue
    }

    // Collision: multiple sheets claim the same entry.
    // The sheet whose normalised name matches the entry description keeps it.
    const normEntry = normaliseName(entry.description)
    const winner = group.find((name) => normaliseName(name) === normEntry)

    if (winner != null) {
      result.set(winner, entry)
      claimed.add(entry.itemNo)
      for (const name of group) {
        if (name !== winner) unresolved.push(name)
      }
    } else {
      // No name match — all go to fallback.
      for (const name of group) unresolved.push(name)
    }
  }

  // Step 3: name-based fallback for unresolved sheets.
  const unclaimed = entries.filter((e) => !claimed.has(e.itemNo))
  for (const name of unresolved) {
    const normSheet = normaliseName(name)
    // Find the unclaimed entry whose normalised description is contained in (or
    // equals) the sheet's normalised name, preferring the longest match.
    let best: SummaryEntry | null = null
    let bestLen = -1
    for (const entry of unclaimed) {
      const normEntry = normaliseName(entry.description)
      if (normSheet.includes(normEntry) && normEntry.length > bestLen) {
        best = entry
        bestLen = normEntry.length
      }
    }
    result.set(name, best)
    if (best != null) {
      claimed.add(best.itemNo)
      unclaimed.splice(unclaimed.indexOf(best), 1)
    }
  }

  return result
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
  // Priced rows no sheet could classify, stamped with their sheet name. Surfaced
  // so a value is never silently dropped (cf. the digit-led "10.1" Shoprite row).
  const unclassifiedRows: ParsedUnclassifiedRow[] = []
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
    const { sections, items, unclassified } = parseSheet(name, rows, cls)
    for (const u of unclassified) unclassifiedRows.push({ sheet: name, ...u })
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
  // Match ALL tenant sheets to summary entries in one pass: primary by leading
  // number, collision-resolve by name, fallback by name containment. Bill ORDER
  // follows the matched entry's itemNo (not the raw sheet leading number), so a
  // mis-numbered sheet (e.g. "20-93 Cashbuild" → item 21) sorts correctly.
  const tenantMatchMap = matchTenantSheets(
    tenantSheets.map((s) => s.name),
    summary.entries,
  )

  const tenantBills: { bill: ParsedBill; order: number }[] = []
  for (const sheet of tenantSheets) {
    const billRootTempId = `bill#${sheet.name}`
    const entry = tenantMatchMap.get(sheet.name) ?? null

    // Sort by the MATCHED entry's itemNo, falling back to the raw leading number
    // if the entry is null (unknown sheets sort last either way).
    const orderItemNo = entry?.itemNo ?? tenantLeadingItemNo(sheet.name)
    const orderN = orderItemNo != null ? Number(orderItemNo) : NaN
    const order = isNaN(orderN) ? Number.MAX_SAFE_INTEGER : orderN

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
      order,
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
    unclassifiedRows,
  }
}
