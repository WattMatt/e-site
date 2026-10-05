/**
 * Read one table out of `pdftotext -layout` pages by POSITION.
 *
 * SABS tables number their columns ("1  2  3  4") under the header. pdftotext
 * keeps that row's horizontal layout, so each printed column number gives the
 * column's x centre, and every value on a data line is placed in the column
 * whose centre is nearest. A spec may name a different centre row — the zone
 * row "1 2 3 4 5 5H 6 7" of SANS 10400-XA, or the "2 3 … 20" row of a
 * grouping table — and a volt-drop table switches to its "r x z" sub-columns
 * from the line that prints them.
 *
 * Rows are keyed one of four ways: a number in the key column (the default), a
 * band ("1,5 – 10", "> 45"), a short code ("A1"), or — for tables whose keys are
 * drawings or multi-line labels — ORDERED: the spec lists the rows and each
 * value line is matched to the next one, with a label check nearby.
 *
 * Nothing is guessed. The extractor throws — and so loads nothing — when the
 * heading or the centre row is missing, a row key is unexpected, missing or
 * repeated, two values land in one cell, a value sits between two columns, a
 * required cell is blank, a condition the spec names is not printed, or the
 * ordered rows and value lines disagree in number.
 *
 * Every row carries its citation: clause, PDF page, printed page, and the cell
 * values exactly as printed (so the reader sees "0,180", not 0.18).
 */
import { pageOffset, parseCell, printedPage, type PdfPage } from './pdf-text'

export type Topic = 'cable_ratings' | 'volt_drop' | 'derating' | 'earthing_protection' | 'building_energy'

export interface ColumnSpec {
  key: string
  label: string
  unit: string | null
  /** 1-based position in the centre row (the printed column number by default). */
  header: number
  /** Cells allowed to be blank (nothing printed at all). */
  sparse?: boolean
  /** 'text': what is printed in this column, words and numbers alike (a description, a rule like "S/2"). Counts as a value. */
  type?: 'number' | 'text'
  /** Printed header group this column sits under, for display ("Buried directly"). */
  group?: string
}

export interface KeyColumnSpec extends ColumnSpec {
  /** number (default) | band ("1,5 – 10" → "1.5–10") | text ("A1"). */
  kind?: 'number' | 'band' | 'text'
}

export interface ConditionSpec {
  key: string
  label: string
  unit: string | null
  /** Matched against each line of the table's pages; group 1 is the printed value. */
  match: RegExp
}

export interface OrderedRow {
  key: string
  label: string
  /** Must match one of the lines from four above the value line to two below it. */
  near: RegExp
}

export interface TableSpec {
  /** Clause as printed, e.g. "6.13" → heading "Table 6.13 —". */
  clause: string
  title: string
  topic: Topic
  keyColumn: KeyColumnSpec
  valueColumns: ColumnSpec[]
  /** Number keys the table must yield, in order. */
  expectedKeys?: number[]
  /** Band/text keys the table must yield, in order (normalised: "1.5–10", "A1"). */
  expectedTextKeys?: string[]
  /** ORDERED mode: the rows in printed order; the key column is not read. */
  rows?: OrderedRow[]
  /** In ORDERED mode, a value line needs at least this many cells (default 1). */
  minCells?: number
  /** The row that gives column centres; default the "1 2 … N" column-number row. */
  centresRow?: RegExp
  /** The centres row is itself a data row (a fully printed row used for positions). */
  centresRowIsData?: boolean
  /** 'start': columns are left-aligned — place values by where they start, not their centre. */
  anchor?: 'centre' | 'start'
  /** Volt-drop tables: from the line matching `trigger` (the "r x z" row), values use these columns. */
  subColumns?: {
    trigger: RegExp
    columns: ColumnSpec[]
    /** Main columns printed once per row in the sub rows too (e.g. the d.c. column), kept at their main centre. */
    keepMain?: string[]
    /**
     * When a sub row prints exactly one value per sub column (after the key and the
     * keepMain columns), assign them in printed order. Any other count is placed by
     * position as usual. For text layers whose values drift between r/x/z labels.
     */
    byOrderWhenComplete?: boolean
  }
  /** 'first' (default): the heading page only. 'all': also its (continued)/(concluded) pages. 'continuation': only those. */
  pages?: 'first' | 'all' | 'continuation'
  /** Stop reading a page's region at the first line matching this. */
  stopAt?: RegExp
  /** A value printed once for a band of rows [from, to] (see ExtractedRow.citation.spanned_columns). */
  spanned?: { column: string; from: number; to: number }
  /** Short printed parameters the table is valid for ("Ambient temperature: 30 °C"). */
  conditions?: ConditionSpec[]
  /** Human-readable remark kept with the table (never clause text). */
  remark?: string
  /** Code suffix when one clause yields two tables (e.g. 6.8 copper / aluminium). */
  codeSuffix?: string
}

export interface ExtractedRow {
  sort_key: number
  row_data: Record<string, number | string | null>
  citation: {
    clause: string
    page_pdf: number
    page_printed: number
    /** Each cell as printed ("0,180", "1 138", "–"), so precision is never lost. */
    printed?: Record<string, string>
    spanned_columns?: string[]
  }
}

export interface ExtractedCondition {
  key: string
  label: string
  unit: string | null
  /** As printed, decimal comma normalised ("0.5"). */
  value: string
  page_pdf: number
  page_printed: number
}

export interface ExtractedTable {
  rows: ExtractedRow[]
  conditions: ExtractedCondition[]
}

interface Token { x: number; start: number; text: string }

/**
 * Largest distance from a column centre, as a fraction of the narrowest column
 * gap. Under 0.5 so a value midway between two columns is refused. Measured on
 * SANS 10142-1 2017 + 2021: every table extracts at 0.35 and above.
 */
const DRIFT_FRACTION = 0.4

/**
 * Whitespace-separated tokens with their x centres. Columns are always two or
 * more spaces apart, so two things separated by ONE space are one cell: a
 * thousands group ("1 138") or a phrase of words ("Entertainment hall").
 */
export function lineTokens(line: string): Token[] {
  const raw: Array<{ start: number; end: number; text: string }> = []
  const re = /\S+/g
  let m: RegExpExecArray | null
  while ((m = re.exec(line)) !== null) raw.push({ start: m.index, end: m.index + m[0].length, text: m[0] })
  const merged: typeof raw = []
  for (const t of raw) {
    const prev = merged[merged.length - 1]
    const isWord = (x: string): boolean => parseCell(x) === undefined && /[A-Za-z]/.test(x)
    if (prev && t.start - prev.end === 1 && (
      (/^\d{1,3}(?: \d{3})*$/.test(prev.text) && /^\d{3}$/.test(t.text)) ||
      // A phrase ("Entertainment hall") is one cell: words one space apart belong together.
      (isWord(prev.text) && isWord(t.text))
    )) {
      prev.text = `${prev.text} ${t.text}`
      prev.end = t.end
    } else {
      merged.push({ ...t })
    }
  }
  return merged.map((t) => ({ x: (t.start + t.end) / 2, start: t.start, text: t.text }))
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

/** The heading page and the (continued)/(concluded) pages that follow it. */
function tableSegments(pages: PdfPage[], spec: TableSpec): Array<{ page: PdfPage; from: number }> {
  const { pageIdx, lineIdx } = findTablePage(pages, spec.clause)
  const segs = [{ page: pages[pageIdx], from: lineIdx + 1 }]
  const cont = new RegExp(`^\\s*Table\\s+${escapeRe(spec.clause)}\\s*\\((continued|concluded)\\)`)
  for (let p = pageIdx + 1; p < pages.length; p++) {
    const i = pages[p].lines.findIndex((l) => cont.test(l))
    if (i < 0) break
    segs.push({ page: pages[p], from: i + 1 })
  }
  const mode = spec.pages ?? 'first'
  if (mode === 'first') return segs.slice(0, 1)
  if (mode === 'continuation') {
    if (segs.length < 2) throw new Error(`Table ${spec.clause}: no continuation page`)
    return segs.slice(1)
  }
  return segs
}

const CLAUSE_LINE = /^\s*(?:\d+(?:\.\d+){1,}|[A-Z]\.\d+(?:\.\d+)*)\s+[A-Z]/
const FOOTNOTE_LINE = /^\s*[a-z]\s{2,}[A-Z][a-z]/

/** Region of one page: from the heading to the next table heading, NOTE, clause, footnote or stopAt. */
function regionOf(page: PdfPage, from: number, spec: TableSpec): string[] {
  const region: string[] = []
  for (let i = from; i < page.lines.length; i++) {
    const l = page.lines[i]
    if (/^\s*Table\s+[0-9A-Z]+\.\d/.test(l)) break
    if (/^\s*NOTE\b/.test(l)) break
    if (CLAUSE_LINE.test(l)) break
    if (FOOTNOTE_LINE.test(l)) break
    if (spec.stopAt && spec.stopAt.test(l)) break
    // The footer line ("118  © SABS") is not table content. A data row can also
    // share its line with "© SABS"; then only the footer text is blanked, keeping positions.
    if (/^\s*(?:\d{1,3}\s+)?©\s*SABS(?:\s+\d{1,3})?\s*$/.test(l)) continue
    region.push(l.replace(/©\s*SABS/g, (m) => ' '.repeat(m.length)))
  }
  return region
}

/** Normalise a printed cell for storage as text ("1,5" → "1.5", "1 138" → "1138"). */
function normaliseText(s: string): string {
  return s.replace(/(\d) (\d{3})/g, '$1$2').replace(/(\d),(\d)/g, '$1.$2')
}

function bandKey(tokens: string[]): { key: string; lower: number } | null {
  const joined = normaliseText(tokens.join(' ')).replace(/\s*[–-]\s*/g, '–').replace(/\s+/g, ' ').trim()
  const nums = joined.match(/\d+(?:\.\d+)?/g)
  if (!nums) return null
  return { key: joined.replace(/\s+/g, ''), lower: Number(nums[0]) }
}

export function extractTable(pages: PdfPage[], spec: TableSpec): ExtractedTable {
  const offset = pageOffset(pages)
  const segments = tableSegments(pages, spec)
  const keyKind = spec.keyColumn.kind ?? 'number'
  const ordered = !!spec.rows
  const clauseLabel = `Table ${spec.clause}`

  const rows = new Map<string, ExtractedRow>()
  const orderedLines: Array<{ cells: Map<string, { v: number | string | null; printed: string }>; page: PdfPage; context: string[] }> = []
  const keyless: Array<{ col: string; value: number | null; printed: string }> = []
  const conditions = new Map<string, ExtractedCondition>()
  const subRows = new Set<string>()

  for (const { page, from } of segments) {
    const pagePrinted = printedPage(page, offset)

    // Conditions are printed above the table or in its footnotes: search every line of the page from the heading on.
    for (const c of spec.conditions ?? []) {
      if (conditions.has(c.key)) continue
      for (const l of page.lines.slice(from - 1)) {
        const m = l.match(c.match)
        if (m && m[1]) {
          conditions.set(c.key, { key: c.key, label: c.label, unit: c.unit, value: normaliseText(m[1].trim()), page_pdf: page.pdfPage, page_printed: pagePrinted })
          break
        }
      }
    }

    const region = regionOf(page, from, spec)
    const allCols = [spec.keyColumn, ...spec.valueColumns].filter((c) => c.header > 0)
    const maxHeader = Math.max(...allCols.map((c) => c.header))
    let headerAt = -1
    let centres: number[] = []
    for (let i = 0; i < region.length; i++) {
      const t = lineTokens(region[i])
      const isCentreRow = spec.centresRow
        ? spec.centresRow.test(region[i])
        : t.length === maxHeader && t.every((tok, k) => tok.text === String(k + 1))
      if (isCentreRow) { headerAt = i; centres = t.map((tok) => (spec.anchor === 'start' ? tok.start : tok.x)); break }
    }
    if (headerAt < 0) throw new Error(`${clauseLabel}: column-centre row not found on PDF page ${page.pdfPage}`)
    const posOf = (tok: Token): number => (spec.anchor === 'start' ? tok.start : tok.x)
    for (const c of allCols) {
      if (centres[c.header - 1] === undefined) throw new Error(`${clauseLabel}: column ${c.key} has no centre (header ${c.header})`)
    }

    // The active layout: every centre of the centre row, mapped to the spec column printed there (if any).
    type Slot = { x: number; col: ColumnSpec | null }
    const mainLayout: Slot[] = centres.map((x, i) => ({ x, col: allCols.find((c) => c.header === i + 1) ?? null }))
    let layout = mainLayout
    let inSub = false
    const driftFor = (slots: Slot[]): number => {
      const xs = slots.map((s) => s.x).sort((p, q) => p - q)
      let minGap = Infinity
      for (let k = 1; k < xs.length; k++) minGap = Math.min(minGap, xs[k] - xs[k - 1])
      return minGap * DRIFT_FRACTION
    }
    let maxDrift = driftFor(layout)

    for (let li = spec.centresRowIsData ? headerAt : headerAt + 1; li < region.length; li++) {
      const line = region[li]
      if (spec.subColumns && spec.subColumns.trigger.test(line)) {
        // From here on, values sit under the r / x / z sub-columns; the key keeps its main centre.
        const subX = lineTokens(line).map((t) => t.x)
        const keep = new Set(spec.subColumns.keepMain ?? [])
        const kept = mainLayout.filter((s) => s.col === spec.keyColumn || (s.col && keep.has(s.col.key)))
        const subSlots = subX.map((x, i) => ({ x, col: spec.subColumns!.columns.find((c) => c.header === i + 1) ?? null }))
        layout = [...kept, ...subSlots].sort((p, q) => p.x - q.x)
        maxDrift = driftFor(subSlots)
        inSub = true
        continue
      }
      const toks = lineTokens(line)
      const cells = new Map<string, { v: number | string | null; printed: string }>()
      if (inSub && spec.subColumns?.byOrderWhenComplete) {
        // Exact count → printed order. The key and kept main columns are taken first, by position.
        const subCols = [...spec.subColumns.columns].sort((p, q) => p.header - q.header)
        const keptSlots = layout.filter((sl) => sl.col && sl.col !== spec.keyColumn && (spec.subColumns!.keepMain ?? []).includes(sl.col.key))
        const keySlot = layout.find((sl) => sl.col === spec.keyColumn)
        const valueToks = toks.filter((t) => parseCell(t.text) !== undefined)
        const isKeyOrKept = (t: Token): boolean => {
          const pos = posOf(t)
          const near = [keySlot, ...keptSlots].filter(Boolean) as Slot[]
          const firstSub = layout.filter((sl) => subCols.includes(sl.col as ColumnSpec)).reduce((m, sl) => Math.min(m, sl.x), Infinity)
          return near.some((sl) => Math.abs(sl.x - pos) < Math.abs(firstSub - pos))
        }
        const lead = valueToks.filter(isKeyOrKept)
        const rest = valueToks.filter((t) => !isKeyOrKept(t))
        if (lead.length === 1 + keptSlots.length && rest.length === subCols.length && !toks.some((t) => parseCell(t.text) === undefined)) {
          const key = parseCell(lead[0].text)
          if (typeof key === 'number') {
            const k = String(key)
            const expected = spec.expectedKeys?.map(String) ?? []
            if (!expected.includes(k)) throw new Error(`${clauseLabel}: unexpected row key ${k}`)
            if (rows.has(k)) throw new Error(`${clauseLabel}: row key ${k} appears twice`)
            const row_data: Record<string, number | string | null> = { [spec.keyColumn.key]: key }
            const printed: Record<string, string> = { [spec.keyColumn.key]: lead[0].text }
            keptSlots.forEach((sl, i) => { row_data[sl.col!.key] = parseCell(lead[i + 1].text) as number | null; printed[sl.col!.key] = lead[i + 1].text })
            subCols.forEach((c, i) => { row_data[c.key] = parseCell(rest[i].text) as number | null; printed[c.key] = rest[i].text })
            subRows.add(k)
            rows.set(k, { sort_key: key, row_data, citation: { clause: clauseLabel, page_pdf: page.pdfPage, page_printed: pagePrinted, printed } })
            continue
          }
        }
      }
      const keyTokens: string[] = []
      const textTokens = new Map<string, string[]>()
      let hasWords = false
      let stray: Token | null = null
      for (const tok of toks) {
        const v = parseCell(tok.text)
        if (v === undefined) hasWords = true
        let best = 0
        const pos = posOf(tok)
        for (let k = 1; k < layout.length; k++) if (Math.abs(layout[k].x - pos) < Math.abs(layout[best].x - pos)) best = k
        const slot = layout[best]
        const drift = Math.abs(slot.x - pos)
        if (slot.col === spec.keyColumn) { if (!ordered) keyTokens.push(tok.text); continue }
        if (!slot.col) continue
        if (slot.col.type === 'text') {
          textTokens.set(slot.col.key, [...(textTokens.get(slot.col.key) ?? []), tok.text])
          continue
        }
        if (v === undefined) continue
        if (drift > maxDrift) { stray = tok; continue }
        if (cells.has(slot.col.key)) throw new Error(`${clauseLabel}: two values in column ${slot.col.key}: "${line.trim()}"`)
        cells.set(slot.col.key, { v, printed: tok.text })
      }
      const numberCells = cells.size
      for (const [k, words] of textTokens) cells.set(k, { v: words.join(' '), printed: words.join(' ') })
      const numericCells = cells.size

      if (ordered) {
        if (numericCells < (spec.minCells ?? 1)) continue
        if (stray) throw new Error(`${clauseLabel}: "${stray.text}" sits between columns: "${line.trim()}"`)
        // Labels sit above the values or wrap onto the lines just below them.
        orderedLines.push({ cells, page, context: region.slice(Math.max(0, li - 4), li + 3) })
        continue
      }

      // Key.
      let key: string | null = null
      let sortKey: number | null = null
      if (keyKind === 'number') {
        const n = keyTokens.length === 1 ? parseCell(keyTokens[0]) : undefined
        if (typeof n === 'number') { key = String(n); sortKey = n }
      } else if (keyKind === 'band') {
        const b = keyTokens.length ? bandKey(keyTokens) : null
        if (b) { key = b.key; sortKey = b.lower }
      } else if (keyTokens.length && numberCells > 0) {
        // A text key ("A1") needs a number on its line; header lines carry only words.
        key = keyTokens.join(' ').trim(); sortKey = rows.size + 1
      }
      if (key === null) {
        // A caption line ("°C  70 °C", "119 … Edition 2") carries words. A line of bare values
        // without a key can only be a spanned value; anything misplaced on it is refused.
        if (!hasWords) {
          if (stray) throw new Error(`${clauseLabel}: "${stray.text}" sits between columns: "${line.trim()}"`)
          for (const [col, c] of cells) keyless.push({ col, value: typeof c.v === 'number' ? c.v : null, printed: c.printed })
        }
        continue
      }
      if (stray) throw new Error(`${clauseLabel}: "${stray.text}" sits between columns: "${line.trim()}"`)
      if (numericCells === 0) continue // a key alone (e.g. a stray page number)
      const expected = keyKind === 'number' ? spec.expectedKeys?.map(String) : spec.expectedTextKeys
      if (!expected || !expected.includes(key)) throw new Error(`${clauseLabel}: unexpected row key ${key}`)
      if (rows.has(key)) throw new Error(`${clauseLabel}: row key ${key} appears twice`)
      const row_data: Record<string, number | string | null> = { [spec.keyColumn.key]: keyKind === 'number' ? sortKey! : key }
      const printed: Record<string, string> = { [spec.keyColumn.key]: keyTokens.join(' ') }
      for (const [k, c] of cells) { row_data[k] = c.v; printed[k] = c.printed }
      if (inSub) {
        subRows.add(key)
        // One dash printed across a whole r/x/z group means the group does not apply.
        const groups = new Map<string, ColumnSpec[]>()
        for (const c of spec.subColumns!.columns) if (c.group) groups.set(c.group, [...(groups.get(c.group) ?? []), c])
        for (const gcols of groups.values()) {
          const present = gcols.filter((c) => c.key in row_data)
          if (present.length === 1 && row_data[present[0].key] === null) {
            for (const c of gcols) { row_data[c.key] = null; printed[c.key] = printed[present[0].key] }
          }
        }
      }
      rows.set(key, {
        sort_key: sortKey!,
        row_data,
        citation: { clause: clauseLabel, page_pdf: page.pdfPage, page_printed: pagePrinted, printed },
      })
    }
  }

  // ORDERED: one value line per declared row, each with its label nearby.
  if (ordered) {
    const defs = spec.rows!
    if (orderedLines.length !== defs.length) {
      throw new Error(`${clauseLabel}: ${orderedLines.length} value lines for ${defs.length} declared rows`)
    }
    defs.forEach((d, i) => {
      const ln = orderedLines[i]
      if (!ln.context.some((l) => d.near.test(l))) throw new Error(`${clauseLabel}: row "${d.key}" — label not found near its values`)
      const row_data: Record<string, number | string | null> = { [spec.keyColumn.key]: d.label }
      const printed: Record<string, string> = {}
      for (const [k, c] of ln.cells) { row_data[k] = c.v; printed[k] = c.printed }
      rows.set(d.key, {
        sort_key: i + 1,
        row_data,
        citation: { clause: clauseLabel, page_pdf: ln.page.pdfPage, page_printed: printedPage(ln.page, offset), printed },
      })
    })
  }

  if (spec.spanned) {
    const s = spec.spanned
    const inBand = [...rows.values()].filter((r) => r.sort_key >= s.from && r.sort_key <= s.to)
    const onRows = inBand.filter((r) => s.column in r.row_data)
    const onLines = keyless.filter((k) => k.col === s.column)
    const printedVals = [...onRows.map((r) => ({ v: r.row_data[s.column], p: r.citation.printed?.[s.column] ?? '' })), ...onLines.map((k) => ({ v: k.value, p: k.printed }))]
    if (printedVals.length !== 1 || printedVals[0].v == null) {
      throw new Error(`${clauseLabel}: expected exactly one spanned value in ${s.column} for ${s.from}–${s.to}, found ${printedVals.length}`)
    }
    if (keyless.length !== onLines.length) throw new Error(`${clauseLabel}: number(s) on lines without a row key outside the spanned column`)
    for (const r of inBand) {
      r.row_data[s.column] = printedVals[0].v
      r.citation.printed = { ...(r.citation.printed ?? {}), [s.column]: printedVals[0].p }
      r.citation.spanned_columns = [...(r.citation.spanned_columns ?? []), s.column]
    }
  } else if (keyless.length > 0 && !ordered) {
    throw new Error(`${clauseLabel}: ${keyless.length} number(s) on lines without a row key`)
  }

  // Completeness.
  const expectedKeys = ordered ? spec.rows!.map((r) => r.key)
    : (spec.keyColumn.kind ?? 'number') === 'number' ? (spec.expectedKeys ?? []).map(String) : spec.expectedTextKeys ?? []
  const missing = expectedKeys.filter((k) => !rows.has(k))
  if (missing.length) throw new Error(`${clauseLabel}: missing row(s) ${missing.join(', ')}`)
  for (const [k, r] of rows) {
    const required = subRows.has(k)
      ? [...spec.subColumns!.columns, ...spec.valueColumns.filter((c) => (spec.subColumns!.keepMain ?? []).includes(c.key))]
      : spec.valueColumns
    for (const c of required) {
      if (!(c.key in r.row_data) && !c.sparse) throw new Error(`${clauseLabel}: row ${r.sort_key} has no value in ${c.key}`)
    }
  }
  for (const c of spec.conditions ?? []) {
    if (!conditions.has(c.key)) throw new Error(`${clauseLabel}: condition "${c.label}" not printed`)
  }

  return { rows: expectedKeys.map((k) => rows.get(k)!), conditions: [...conditions.values()] }
}
