import ExcelJS from 'exceljs'
import type {
  Aoa,
  Cell,
  ColumnMap,
  ParsedSheet,
  ParsedSummary,
  ParsedTenderRow,
  ParsedTenderWorkbook,
  RateCellType,
  SummaryLine,
  UnclassifiedRow,
} from './types'

// ─── Cell coercion ──────────────────────────────────────────────────────────

/** Prefer a formula's cached result, then rich text, then the raw value. */
function coerce(value: ExcelJS.CellValue | undefined): Cell {
  if (value == null) return null
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string') {
    const t = value.trim()
    return t === '' ? null : t
  }
  if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE'
  if (value instanceof Date) return value.toISOString()
  const o = value as { result?: unknown; richText?: { text?: string }[]; text?: unknown; error?: unknown }
  if (o.result !== undefined) {
    if (o.result != null && typeof o.result === 'object' && 'error' in (o.result as object)) return null
    return coerce(o.result as ExcelJS.CellValue)
  }
  if (Array.isArray(o.richText)) {
    const t = o.richText.map((r) => r.text ?? '').join('').trim()
    return t === '' ? null : t
  }
  if (typeof o.text === 'string') {
    const t = o.text.trim()
    return t === '' ? null : t
  }
  return null
}

/**
 * The text a person sees in the cell. ExcelJS's `cell.text` ignores the number
 * format, so a code typed as the number 1.1 with format 0.00 (shown "1.10")
 * would read as "1.1" and collide with the real 1.1. Apply the format's fixed
 * decimal places ourselves.
 */
function displayText(cell: ExcelJS.Cell): string {
  const v = cell.value
  if (typeof v === 'number') {
    const m = /0\.(0+)/.exec(cell.numFmt ?? '')
    return m ? v.toFixed(m[1].length) : String(v)
  }
  try {
    return (cell.text ?? '').trim()
  } catch {
    // ExcelJS throws on some exotic formula cells; fall back to no display text.
    return ''
  }
}

/**
 * Worksheet → 0-indexed rows of scalars plus each cell's displayed text. Only
 * the top-left cell of a merged range carries a value: ExcelJS repeats the
 * master's value in every slave cell, which would turn a description merged
 * across UNIT into a unit, or count a vertically merged amount twice.
 */
function readSheet(ws: ExcelJS.Worksheet): { rows: Aoa; text: string[][] } {
  const rows: Aoa = []
  const text: string[][] = []
  const last = ws.rowCount
  for (let r = 1; r <= last; r++) {
    const row = ws.getRow(r)
    const vals: Cell[] = []
    const txt: string[] = []
    const width = Math.max(row.cellCount, row.actualCellCount)
    for (let c = 1; c <= width; c++) {
      const cell = row.getCell(c)
      const slave = cell.isMerged && cell.master !== cell
      vals.push(slave ? null : coerce(cell.value))
      txt.push(slave ? '' : displayText(cell))
    }
    rows.push(vals)
    text.push(txt)
  }
  return { rows, text }
}

export function toNumber(v: Cell): number | null {
  if (v == null) return null
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  const s = v.replace(/[\s,]/g, '').replace(/^R/i, '')
  if (s === '' || !/^-?\d*\.?\d+(e-?\d+)?$/i.test(s)) return null
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}

const str = (v: Cell): string => (v == null ? '' : String(v).replace(/\s+/g, ' ').trim())

export function columnLetter(index: number): string {
  let n = index + 1
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

// ─── Header detection ───────────────────────────────────────────────────────

function headerField(raw: Cell): keyof ColumnMap | null {
  const h = str(raw).toUpperCase().replace(/\.$/, '')
  if (h === '') return null
  if (h.includes('DESCRIPTION')) return 'description'
  if (h.startsWith('ITEM')) return 'item'
  if (h.startsWith('UNIT')) return 'unit'
  if (h === 'QTY' || h.startsWith('QTY') || h.startsWith('QUANTITY')) return 'qty'
  if (h.startsWith('SUPPLY')) return 'supply'
  if (h.startsWith('INSTALL')) return 'install'
  if (h.startsWith('RATE')) return 'rate'
  if (h.startsWith('AMOUNT') || h.startsWith('TOTAL')) return 'amount'
  return null
}

function findHeader(rows: Aoa): { index: number; columns: ColumnMap } | null {
  for (let i = 0; i < rows.length; i++) {
    if (!rows[i].some((c) => { const h = str(c).toUpperCase(); return h.includes('DESCRIPTION') && h.length <= 40 })) continue
    const columns: ColumnMap = {}
    rows[i].forEach((c, col) => {
      const f = headerField(c)
      if (f && columns[f] === undefined) columns[f] = col
    })
    return { index: i, columns }
  }
  return null
}

// ─── Code hierarchy ─────────────────────────────────────────────────────────

/** Is `child` directly or indirectly below `parent`? ('2.1' > '2.1.3', 'C' > 'C1', 'C1' > 'C1.1') */
export function isDescendant(parent: string, child: string): boolean {
  if (child.length <= parent.length || !child.startsWith(parent)) return false
  const next = child[parent.length]
  if (next === '.') return true
  // A lettered parent ('C') owns a numbered child ('C1'); a numbered parent needs the dot.
  return /[A-Za-z]$/.test(parent) && /\d/.test(next)
}

const TOTAL_RE = /\bTOTAL\b|CARRIED\s+(FORWARD|TO)/i
const BROUGHT_FORWARD_RE = /\bBROUGHT\s+FORWARD\b|\bB\/F\b/i

function isTotalText(t: string): boolean {
  return TOTAL_RE.test(t) && (/^(SUB[\s-]?)?TOTAL\b/i.test(t) || /CARRIED|SUMMARY|BILL|FORWARD/i.test(t))
}

/**
 * A total row carries no unit or quantity, and its "code" cell is either empty
 * or itself the total text. A coded item whose DESCRIPTION happens to start with
 * "Total" ("Total station survey") is an item, not a total.
 */
function isTotalRow(code: string, description: string, unit: string | null, quantity: number | null): boolean {
  if (unit != null || quantity != null) return false
  if (code !== '') return isTotalText(code)
  return isTotalText(description)
}

const FIXED_UNIT_RE = /^(P\.?C\.?|P\.?S\.?)$/i
// Deliberately narrow: "Provisional quantities" are remeasurable items and "PC"
// also means a computer socket, so neither alone makes a sum fixed.
const FIXED_TEXT_RE = /\bPROVISIONAL\s+SUMS?\b|\bPRIME\s+COST\b|\bP\.?C\.?\s+SUMS?\b|\bCONTINGENC/i

function guessRateCellType(
  qtyRaw: Cell,
  unit: string | null,
  quantity: number | null,
  description: string,
  headingTexts: string[],
): RateCellType {
  if (str(qtyRaw).toUpperCase() === 'RATE ONLY') return 'rate_only'
  if (unit && FIXED_UNIT_RE.test(unit)) return 'fixed'
  if (FIXED_TEXT_RE.test(description)) return 'fixed'
  if (headingTexts.some((h) => FIXED_TEXT_RE.test(h))) return 'fixed'
  if (unit && quantity == null) return 'rate_only'
  return 'priced'
}

function billCodeFromName(name: string): string | null {
  const m1 = /^\s*BILL\s*(?:NO\.?|NUMBER)?\s*([A-Z0-9]+)/i.exec(name)
  if (m1) return m1[1].toUpperCase()
  const m2 = /^\s*([A-Z]{1,2}|\d{1,3})\s*[-–:.]\s+\S/.exec(name)
  if (m2) return m2[1].toUpperCase()
  return null
}

function billCodeFromCodes(codes: string[]): string | null {
  for (const c of codes) {
    const m = /^([A-Za-z]+|\d+)/.exec(c)
    if (m) return m[1].toUpperCase()
  }
  return null
}

// ─── Bill sheet ─────────────────────────────────────────────────────────────

function parseBillSheet(
  name: string,
  rows: Aoa,
  text: string[][],
  header: { index: number; columns: ColumnMap },
  unclassified: UnclassifiedRow[],
): ParsedSheet {
  const { columns } = header
  const at = (row: Cell[], key: keyof ColumnMap): Cell => {
    const i = columns[key]
    return i === undefined ? null : (row[i] ?? null)
  }
  const codeOf = (r: number): string => {
    const i = columns.item
    if (i === undefined) return ''
    const shown = text[r]?.[i] ?? ''
    return shown !== '' ? shown.replace(/\s+/g, ' ').trim() : str(rows[r][i] ?? null)
  }

  // Every code on the sheet, so a heading can be recognised by having children.
  const allCodes: string[] = []
  for (let r = header.index + 1; r < rows.length; r++) {
    const c = codeOf(r)
    if (c && !isTotalText(c)) allCodes.push(c)
  }
  const hasChildren = (code: string) => allCodes.some((c) => isDescendant(code, c))
  const billCode = billCodeFromName(name) ?? billCodeFromCodes(allCodes) ?? name

  const rateColumn = columns.rate !== undefined ? columnLetter(columns.rate) : null
  const amountColumn = columns.amount !== undefined ? columnLetter(columns.amount) : null

  const out: ParsedTenderRow[] = []
  const stack: { code: string; text: string }[] = []
  let statedTotal: number | null = null
  // After the bill's "… TO SUMMARY" total, rows that repeat earlier codes are a
  // recap block and must not be counted again.
  let billClosed = false
  const seenCodes = new Set<string>()

  for (let r = header.index + 1; r < rows.length; r++) {
    const row = rows[r]
    const rowNumber = r + 1
    const code = codeOf(r)
    let description = str(at(row, 'description'))
    if (description === '' && columns.description !== undefined) {
      // A description sometimes spills into the unlabelled column beside it.
      const next = row[columns.description + 1]
      const mapped = Object.values(columns).includes(columns.description + 1)
      if (!mapped && typeof next === 'string') description = str(next)
    }
    const unitRaw = at(row, 'unit')
    const unit = str(unitRaw) || null
    const qtyRaw = at(row, 'qty')
    const quantity = toNumber(qtyRaw)
    const rate = toNumber(at(row, 'rate'))
    const amount = toNumber(at(row, 'amount'))

    if (code === '' && description === '' && unit == null && quantity == null && amount == null) continue

    const base = (
      kind: ParsedTenderRow['kind'],
      c: string | null,
      d: string,
      u: string | null,
      q: number | null,
      a: number | null,
    ): ParsedTenderRow => ({
      sheet: name,
      rowNumber,
      kind,
      billCode,
      code: c,
      description: d,
      unit: u,
      quantity: q,
      headingPath: stack.map((s) => s.code),
      rateCellType: null,
      rate: null,
      amount: a,
      rateColumn: null,
      amountColumn: null,
    })
    const texts = [code, description].filter(Boolean)
    if (isTotalRow(code, description, unit, quantity)) {
      const lastNumeric = [...row].reverse().map(toNumber).find((n) => n != null) ?? null
      const stated = amount ?? lastNumeric
      if (stated != null) statedTotal = stated
      if (/SUMMARY/i.test(texts.join(' '))) billClosed = true
      out.push(base('total', null, texts.join(' '), null, null, stated))
      continue
    }

    if (code === '' && unit == null && quantity == null && BROUGHT_FORWARD_RE.test(description)) {
      out.push(base('note', null, description, null, null, null))
      continue
    }

    if (billClosed && (code === '' || seenCodes.has(code))) {
      // Recap block after the bill total: kept as text, never counted.
      if (description !== '' || code !== '') out.push(base('note', code || null, description, null, null, null))
      continue
    }

    if (code === '') {
      if (amount != null && amount !== 0) {
        unclassified.push({ sheet: name, rowNumber, code, description, amount, reason: 'priced row without an item code' })
        continue
      }
      if (unit != null || quantity != null) {
        unclassified.push({ sheet: name, rowNumber, code, description, amount, reason: 'row has a unit or quantity but no item code' })
        continue
      }
      if (description !== '') out.push(base('note', null, description, null, null, null))
      continue
    }
    seenCodes.add(code)

    // Maintain the heading stack for this code.
    while (stack.length && !isDescendant(stack[stack.length - 1].code, code)) stack.pop()
    const headingPath = stack.map((s) => s.code)
    const headingTexts = stack.map((s) => s.text)

    const children = hasChildren(code)
    const carriesAmount = amount != null && amount !== 0
    const looksPriceable = unit != null || quantity != null || rate != null || str(qtyRaw) !== '' || amount != null
    const isItem = carriesAmount || (!children && looksPriceable)

    if (!isItem) {
      out.push({ ...base('heading', code, description, unit, quantity, null), headingPath })
      stack.push({ code, text: description })
      continue
    }

    const rateCellType = guessRateCellType(qtyRaw, unit, quantity, description, headingTexts)
    out.push({
      sheet: name,
      rowNumber,
      kind: 'item',
      billCode,
      code,
      description,
      unit,
      quantity,
      headingPath,
      rateCellType,
      rate,
      amount,
      rateColumn,
      amountColumn,
    })
    if (children) stack.push({ code, text: description })
  }

  return { name, billCode, headerRowNumber: header.index + 1, columns, rows: out, statedTotal }
}

// ─── Summary sheet ──────────────────────────────────────────────────────────

function parseSummary(name: string, rows: Aoa, text: string[][]): ParsedSummary {
  const header = findHeader(rows)
  const start = header ? header.index + 1 : 0
  const itemCol = header?.columns.item ?? 0
  const descCol = header?.columns.description ?? 1
  const amountCol = header?.columns.amount

  const lines: SummaryLine[] = []
  let subtotalExVat: number | null = null
  let vat: number | null = null
  let totalInclVat: number | null = null
  let pending: { code: string; description: string } | null = null
  let appendable: SummaryLine | null = null

  for (let r = start; r < rows.length; r++) {
    const row = rows[r]
    const code = (text[r]?.[itemCol] || str(row[itemCol] ?? null)).trim()
    const desc = str(row[descCol] ?? null)
    const amount =
      amountCol !== undefined
        ? toNumber(row[amountCol] ?? null)
        : ([...row].reverse().map(toNumber).find((n) => n != null) ?? null)
    const label = `${code} ${desc}`.toUpperCase()

    if (/\bVAT\b/.test(label) && !/EXCL|EXCLUSIVE/.test(label) && !/INCL/.test(label)) {
      if (amount != null) vat = amount
      pending = appendable = null
      continue
    }
    if (/SUB[\s-]?TOTAL|EXCL(\.|USIVE)?\s+(OF\s+)?VAT/.test(label)) {
      if (amount != null) subtotalExVat = amount
      pending = appendable = null
      continue
    }
    if (/\bTOTAL\b/.test(label)) {
      if (amount != null) totalInclVat = amount
      pending = appendable = null
      continue
    }

    if (code !== '' && amount != null) {
      appendable = { code, description: desc, amount }
      lines.push(appendable)
      pending = null
      continue
    }
    if (code !== '' && amount == null) {
      pending = { code, description: desc }
      appendable = null
      continue
    }
    if (code === '' && amount != null && pending) {
      lines.push({ code: pending.code, description: `${pending.description} ${desc}`.trim(), amount })
      pending = null
      continue
    }
    if (code === '' && amount == null && desc !== '' && appendable) {
      appendable.description = `${appendable.description} ${desc}`.trim()
      appendable = null
    }
  }
  return { sheet: name, lines, subtotalExVat, vat, totalInclVat }
}

// ─── Orchestrator ───────────────────────────────────────────────────────────

/**
 * Parse a tender BOQ workbook into row-faithful sheets plus the summary's stated
 * totals. Pure apart from reading the buffer. A row that carries a price but
 * cannot be classified lands in `unclassified`; a sheet with no header row lands
 * in `skippedSheets`. Nothing is dropped silently.
 */
export async function parseTenderWorkbook(buffer: Buffer | ArrayBuffer | Uint8Array): Promise<ParsedTenderWorkbook> {
  const wb = new ExcelJS.Workbook()
  await wb.xlsx.load(buffer as unknown as Parameters<typeof wb.xlsx.load>[0])

  const sheets: ParsedSheet[] = []
  const skippedSheets: string[] = []
  const skippedPricedSheets: string[] = []
  const unclassified: UnclassifiedRow[] = []
  const summaries: { name: string; rows: Aoa; text: string[][] }[] = []
  const hasNumbers = (rows: Aoa) => rows.some((r) => r.some((c) => typeof c === 'number'))

  for (const ws of wb.worksheets) {
    const { rows, text } = readSheet(ws)
    if (ws.state && ws.state !== 'visible') {
      // Hidden workings must never become rows a tenderer sees.
      skippedSheets.push(ws.name)
      if (hasNumbers(rows)) skippedPricedSheets.push(ws.name)
      continue
    }
    if (/SUMMARY/i.test(ws.name)) {
      summaries.push({ name: ws.name, rows, text })
      continue
    }
    const header = findHeader(rows)
    if (!header || header.columns.description === undefined) {
      skippedSheets.push(ws.name)
      if (hasNumbers(rows)) skippedPricedSheets.push(ws.name)
      continue
    }
    sheets.push(parseBillSheet(ws.name, rows, text, header, unclassified))
  }

  const main = summaries.find((s) => /MAIN\s+SUMMARY/i.test(s.name)) ?? summaries[0] ?? null
  for (const s of summaries) if (s !== main) skippedSheets.push(s.name)
  const summary = main ? parseSummary(main.name, main.rows, main.text) : null

  return { sheets, summary, skippedSheets, skippedPricedSheets, unclassified }
}
