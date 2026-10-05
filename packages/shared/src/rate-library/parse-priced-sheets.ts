/**
 * Parser for priced BOQ sheets laid out as
 *   ITEM | DESCRIPTION | … | UNIT | QTY | RATE | TOTAL
 * (the MVL / WM tender layout). Pure: takes rows, returns priced lines plus a
 * per-sheet reconciliation of line totals against the sheet's stated total.
 *
 * Section path: rows that carry an item code but no quantity or rate are
 * headings at the depth of their code ("2.1" → depth 2). Code-less text rows
 * are sub-headings below the current heading.
 *
 * Supply/install split: children "S - Supply" and "I - Install" under one
 * parent are merged into a single line whose description is the parent's.
 * Other lettered children ("T - End Glanded Terminated") keep their own text
 * and still carry the parent as the last path element.
 */

export interface SheetRows { name: string; rows: string[][]; rowNumbers?: number[] }

export interface PricedLine {
  sheet: string
  /** 1-based row number within the sheet. */
  row: number
  code: string | null
  sectionPath: string[]
  description: string
  unit: string | null
  quantity: number | null
  supplyRate: number | null
  installRate: number | null
  rate: number | null
  amount: number | null
  /** Codes folded into this line (supply + install merge). */
  mergedCodes: string[]
}

export interface SheetReconciliation { sheet: string; statedTotal: number | null; sumOfLines: number; difference: number | null }

const round2 = (n: number) => Math.round(n * 100) / 100

function toNum(s: string | undefined): number | null {
  if (s === undefined) return null
  const t = s.trim().replace(/\s/g, '')
  if (!t) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

/**
 * Rebuild rows from the "--- sheet: X ---" text that the mail tool and similar
 * extractors produce (cells joined by ", "). Descriptions may themselves
 * contain ", ", so a row with more cells than its sheet's header is folded
 * back into the description column.
 */
export function splitExtractedSheetText(text: string): SheetRows[] {
  const out: SheetRows[] = []
  let cur: SheetRows | null = null
  let width = 0
  let rowNo = 0
  for (const raw of text.split(/\r?\n/)) {
    const sh = raw.match(/^--- sheet: (.*) ---$/)
    if (sh) { cur = { name: sh[1].trim(), rows: [], rowNumbers: [] }; out.push(cur); width = 0; rowNo = 0; continue }
    if (!cur || raw.trim() === '') continue
    rowNo++
    // Each row ends with one ", " (or ",") terminator after its last cell.
    let cells = raw.replace(/,\s*$/, '').split(/,\s/).map(c => c.trim())
    if (/^item$/i.test(cells[0]) && cells.some(c => /^description$/i.test(c))) width = cells.length
    if (width && cells.length > width) {
      const extra = cells.length - width
      cells = [cells[0], cells.slice(1, 2 + extra).join(', '), ...cells.slice(2 + extra)]
    }
    cur.rows.push(cells)
    cur.rowNumbers!.push(rowNo)
  }
  return out
}

interface Cols { item: number; desc: number; unit: number; qty: number; rate: number; total: number }

function findHeader(rows: string[][]): { at: number; cols: Cols } | null {
  for (let i = 0; i < rows.length; i++) {
    const r = rows[i].map(c => c.toLowerCase())
    const item = r.findIndex(c => c === 'item')
    const desc = r.findIndex(c => c === 'description')
    const unit = r.findIndex(c => c === 'unit')
    const qty = r.findIndex(c => c === 'qty' || c === 'quantity')
    const rate = r.findIndex(c => c.startsWith('rate'))
    const total = r.findIndex(c => c.startsWith('total') || c === 'amount')
    if (item >= 0 && desc >= 0 && unit >= 0 && qty >= 0 && rate >= 0 && total >= 0) return { at: i, cols: { item, desc, unit, qty, rate, total } }
  }
  return null
}

function nextCodeDepth(rows: string[][], from: number, itemCol: number): number | null {
  for (let j = from; j < rows.length; j++) {
    const c = (rows[j][itemCol] ?? '').trim()
    if (/^\d+(\.\d+)*$/.test(c)) return c.split('.').length
  }
  return null
}

const SUPPLY = /^s\s*-\s*supply\b/i
const INSTALL = /^i\s*-\s*install\b/i

export function parsePricedSheets(sheets: SheetRows[]): { lines: PricedLine[]; reconciliation: SheetReconciliation[] } {
  const lines: PricedLine[] = []
  const reconciliation: SheetReconciliation[] = []

  for (const sheet of sheets) {
    const hdr = findHeader(sheet.rows)
    if (!hdr) continue
    const { cols } = hdr
    const headings: { depth: number; title: string }[] = []
    let statedTotal: number | null = null
    let sum = 0
    const sheetLines: PricedLine[] = []

    for (let i = hdr.at + 1; i < sheet.rows.length; i++) {
      const r = sheet.rows[i]
      const rowNumber = sheet.rowNumbers?.[i] ?? i + 1
      const code = (r[cols.item] ?? '').trim()
      const desc = (r[cols.desc] ?? '').trim()

      if (/^total for bill/i.test(code) || /^total for bill/i.test(desc)) {
        statedTotal = toNum(r[cols.total]) ?? toNum(r.filter(c => c.trim() !== '').at(-1))
        continue
      }
      const unit = (r[cols.unit] ?? '').trim() || null
      const qty = toNum(r[cols.qty])
      const rate = toNum(r[cols.rate])
      const total = toNum(r[cols.total])
      const isCode = /^\d+(\.\d+)*$/.test(code)

      // A heading carries no rate and no total.
      if (rate === null && (total === null || total === 0) && (qty === null || qty === 0) && unit === null) {
        if (!desc) continue
        if (isCode) {
          // A numbered heading whose next numbered row is a SIBLING introduces
          // its siblings ("2.1.1.1 Excavate 600 wide x 1400 deep" above
          // "2.1.1.2 Pickable soil"), so it sits half a level up.
          const own = code.split('.').length
          const next = nextCodeDepth(sheet.rows, i + 1, cols.item)
          const depth = next === own ? own - 0.5 : own
          while (headings.length && headings[headings.length - 1].depth >= depth) headings.pop()
          headings.push({ depth, title: desc })
        } else {
          const depth = (headings.at(-1)?.depth ?? 0) + 0.5
          while (headings.length && headings[headings.length - 1].depth >= depth) headings.pop()
          headings.push({ depth, title: desc })
        }
        continue
      }
      if (!isCode) continue
      // Keep the headings that are ancestors of this code, then make this row
      // the context for anything numbered beneath it ("2.1.4 Cable Marking
      // Tape" is priced AND the parent of "2.1.4.1 S - Supply").
      const depth = code.split('.').length
      while (headings.length && headings[headings.length - 1].depth >= depth) headings.pop()
      const path = headings.map(h => h.title)
      if (desc && !SUPPLY.test(desc) && !INSTALL.test(desc)) headings.push({ depth, title: desc })
      if (total !== null) sum += total

      const parent = path.at(-1) ?? null
      const base: PricedLine = {
        sheet: sheet.name, row: rowNumber, code, sectionPath: [sheet.name, ...path], description: desc, unit, quantity: qty,
        supplyRate: null, installRate: null, rate, amount: total, mergedCodes: [code],
      }

      if (SUPPLY.test(desc) && parent) {
        sheetLines.push({ ...base, description: parent, supplyRate: rate, rate: null })
        continue
      }
      if (INSTALL.test(desc) && parent) {
        const prev = sheetLines.at(-1)
        const prevParent = prev?.sectionPath.at(-1)
        if (prev && prev.supplyRate !== null && prev.installRate === null && prevParent === parent && prev.unit === unit) {
          prev.installRate = rate
          prev.amount = round2((prev.amount ?? 0) + (total ?? 0))
          prev.mergedCodes.push(code)
          continue
        }
        sheetLines.push({ ...base, description: parent, installRate: rate, rate: null })
        continue
      }
      sheetLines.push(base)
    }

    lines.push(...sheetLines)
    reconciliation.push({
      sheet: sheet.name, statedTotal, sumOfLines: round2(sum),
      difference: statedTotal === null ? null : round2(statedTotal - sum),
    })
  }
  return { lines, reconciliation }
}
