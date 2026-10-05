/**
 * Read one numeric table out of `pdftotext -layout` pages by POSITION.
 *
 * SABS tables number their columns ("1  2  3  4") directly under the header.
 * pdftotext keeps that row's horizontal layout, so each printed column number
 * gives the column's x centre, and every number on a data line is placed in
 * the column whose centre is nearest. That survives the two things that break
 * a token-count reader: empty cells (a sparse column simply has no token) and
 * cells that span several rows (printed once, on a line with no row key).
 *
 * Nothing is guessed. The extractor throws — and so loads nothing — when the
 * heading or the column-number row is missing, when a row key is outside the
 * spec's expected list or appears twice, when an expected key is missing,
 * when two numbers land in one cell, or when a required cell is empty.
 */
import { pageOffset, parseCell, printedPage, type PdfPage } from './pdf-text'

export interface ColumnSpec {
  key: string
  label: string
  unit: string | null
  /** The column number printed in the table's "1 2 3 …" row. */
  header: number
  /** Cells allowed to be blank (no number printed at all). */
  sparse?: boolean
}

export interface TableSpec {
  /** Clause as printed, e.g. "6.13" → heading "Table 6.13 —". */
  clause: string
  title: string
  /** The column whose numbers key each row (e.g. ambient temperature). */
  keyColumn: ColumnSpec
  valueColumns: ColumnSpec[]
  /** Every row key the table must yield, in order. */
  expectedKeys: number[]
  /** Stop reading the table at the first line matching this (after the heading). */
  stopAt?: RegExp
  /**
   * A value printed once for a band of rows [from, to]. Depending on the
   * edition's layout it sits on a line of its own or on one row's line inside
   * the band. The extractor requires exactly one number in `column` across the
   * band (keyless line or keyed row), every other row of the band blank in
   * that column, and then fills the band with it. Every cell of the band is
   * marked as spanned in its row's citation.
   */
  spanned?: { column: string; from: number; to: number }
  /** Human-readable remark kept with the table (never clause text). */
  remark?: string
}

export interface ExtractedRow {
  sort_key: number
  row_data: Record<string, number | null>
  citation: {
    clause: string
    page_pdf: number
    page_printed: number
    spanned_columns?: string[]
  }
}

interface Token { x: number; text: string }

/**
 * Largest distance from a column centre, as a fraction of the narrowest column
 * gap. Under 0.5 so a number midway between two columns is refused. Measured on
 * SANS 10142-1 2017 + 2021: every table extracts at 0.35 and above.
 */
const DRIFT_FRACTION = 0.4

function tokens(line: string): Token[] {
  const out: Token[] = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) out.push({ x: m.index + m[0].length / 2, text: m[0] })
  return out
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/** Index of the page carrying the table's heading ("Table 6.13 —"), not a mere reference to it. */
export function findTablePage(pages: PdfPage[], clause: string): { pageIdx: number; lineIdx: number } {
  const heading = new RegExp(`^\\s*Table\\s+${escapeRe(clause)}\\s*[—–-]`)
  for (let p = 0; p < pages.length; p++) {
    const i = pages[p].lines.findIndex((l) => heading.test(l))
    if (i >= 0) return { pageIdx: p, lineIdx: i }
  }
  throw new Error(`Table ${clause}: heading not found`)
}

export function extractTable(pages: PdfPage[], spec: TableSpec): ExtractedRow[] {
  const offset = pageOffset(pages)
  const { pageIdx, lineIdx } = findTablePage(pages, spec.clause)
  const page = pages[pageIdx]
  const pagePrinted = printedPage(page, offset)

  // Region: heading → next table heading / NOTE / stopAt / end of page.
  const region: string[] = []
  for (let i = lineIdx + 1; i < page.lines.length; i++) {
    const l = page.lines[i]
    if (/^\s*Table\s+[0-9A-Z]+\.\d/.test(l)) break
    if (/^\s*NOTE\b/.test(l)) break
    if (spec.stopAt && spec.stopAt.test(l)) break
    region.push(l)
  }

  const allCols = [spec.keyColumn, ...spec.valueColumns]
  const maxHeader = Math.max(...allCols.map((c) => c.header))
  // The column-number row: tokens exactly "1".."N" in order.
  let headerAt = -1
  let centres: number[] = []
  for (let i = 0; i < region.length; i++) {
    const t = tokens(region[i])
    if (t.length === maxHeader && t.every((tok, k) => tok.text === String(k + 1))) {
      headerAt = i
      centres = t.map((tok) => tok.x)
      break
    }
  }
  if (headerAt < 0) throw new Error(`Table ${spec.clause}: column-number row 1..${maxHeader} not found`)

  const nearestHeader = (x: number): number => {
    let best = 0
    for (let k = 1; k < centres.length; k++) {
      if (Math.abs(centres[k] - x) < Math.abs(centres[best] - x)) best = k
    }
    return best + 1
  }
  const byHeader = new Map(allCols.map((c) => [c.header, c]))
  // A number further than this from every column centre belongs to no column:
  // refuse it rather than snap it to the nearest one.
  let minGap = Infinity
  for (let k = 1; k < centres.length; k++) minGap = Math.min(minGap, centres[k] - centres[k - 1])
  const maxDrift = minGap * DRIFT_FRACTION

  const rows = new Map<number, ExtractedRow>()
  const keyless: Array<{ col: string; value: number | null }> = []

  for (const line of region.slice(headerAt + 1)) {
    const cells = new Map<string, number | null>()
    let key: number | null | undefined
    const toks = tokens(line)
    const hasWords = toks.some((t) => parseCell(t.text) === undefined)
    const placed = toks
      .map((tok) => ({ tok, v: parseCell(tok.text) }))
      .filter((p): p is { tok: Token; v: number | null } => p.v !== undefined)
      .map((p) => {
        const h = nearestHeader(p.tok.x)
        return { ...p, h, drift: Math.abs(centres[h - 1] - p.tok.x) }
      })
    const keyed = placed.some((p) => byHeader.get(p.h) === spec.keyColumn && p.drift <= maxDrift)
    // A caption or running-header line ("119 … Edition 2", "°C  70 °C") carries
    // words and no row key: it is not table data.
    if (hasWords && !keyed) continue
    for (const { tok, v, h, drift } of placed) {
      if (drift > maxDrift) {
        throw new Error(`Table ${spec.clause}: "${tok.text}" sits between columns: "${line.trim()}"`)
      }
      const col = byHeader.get(h)
      if (!col) continue
      if (col === spec.keyColumn) {
        if (key !== undefined) throw new Error(`Table ${spec.clause}: two row keys on one line: "${line.trim()}"`)
        key = v
        continue
      }
      if (cells.has(col.key)) throw new Error(`Table ${spec.clause}: two numbers in column ${col.key}: "${line.trim()}"`)
      cells.set(col.key, v)
    }
    if (key === undefined || key === null) {
      // Only a line of bare cell values (no words) can hold a spanned value.
      for (const [col, value] of cells) keyless.push({ col, value })
      continue
    }
    if (cells.size === 0) continue // a number in the key column alone (e.g. a stray page number)
    if (!spec.expectedKeys.includes(key)) {
      throw new Error(`Table ${spec.clause}: unexpected row key ${key}`)
    }
    if (rows.has(key)) throw new Error(`Table ${spec.clause}: row key ${key} appears twice`)
    const row_data: Record<string, number | null> = { [spec.keyColumn.key]: key }
    for (const c of spec.valueColumns) {
      if (cells.has(c.key)) row_data[c.key] = cells.get(c.key)!
    }
    rows.set(key, {
      sort_key: key,
      row_data,
      citation: { clause: `Table ${spec.clause}`, page_pdf: page.pdfPage, page_printed: pagePrinted },
    })
  }

  if (spec.spanned) {
    const s = spec.spanned
    const inBand = [...rows.values()].filter((r) => r.sort_key >= s.from && r.sort_key <= s.to)
    const onRows = inBand.filter((r) => s.column in r.row_data)
    const onLines = keyless.filter((k) => k.col === s.column)
    const printed = [...onRows.map((r) => r.row_data[s.column]), ...onLines.map((k) => k.value)]
    if (printed.length !== 1 || printed[0] == null) {
      throw new Error(`Table ${spec.clause}: expected exactly one spanned value in ${s.column} for ${s.from}–${s.to}, found ${printed.length}`)
    }
    if (keyless.length !== onLines.length) {
      throw new Error(`Table ${spec.clause}: number(s) on lines without a row key outside the spanned column`)
    }
    for (const r of inBand) {
      r.row_data[s.column] = printed[0]
      r.citation.spanned_columns = [...(r.citation.spanned_columns ?? []), s.column]
    }
  } else if (keyless.length > 0) {
    throw new Error(`Table ${spec.clause}: ${keyless.length} number(s) on lines without a row key`)
  }

  const missing = spec.expectedKeys.filter((k) => !rows.has(k))
  if (missing.length) throw new Error(`Table ${spec.clause}: missing row(s) ${missing.join(', ')}`)
  for (const r of rows.values()) {
    for (const c of spec.valueColumns) {
      if (!(c.key in r.row_data) && !c.sparse) {
        throw new Error(`Table ${spec.clause}: row ${r.sort_key} has no value in ${c.key}`)
      }
    }
  }
  return spec.expectedKeys.map((k) => rows.get(k)!)
}
