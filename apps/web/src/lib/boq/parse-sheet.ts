import type { Aoa, ParsedSection, ParsedItem, SheetClassification } from './types'
import type { QuantityMode } from '@esite/shared'

const CATEGORY_RE = /^[A-Z]+\d+$/
const ITEM_RE = /^[A-Z]+\d+\.\d+/

function toNum(v: string | number | null): number | null {
  if (v == null) return null
  if (typeof v === 'number') return isNaN(v) ? null : v
  const s = String(v).trim()
  if (s === '') return null
  const n = Number(s)
  return isNaN(n) ? null : n
}

function toStr(v: string | number | null): string {
  if (v == null) return ''
  return String(v).trim()
}

/**
 * Determine the quantityMode for a line item row.
 * Priority: RATE ONLY > PROVISIONAL/P.C/PRIME COST > lump_sum > measured
 */
function resolveQuantityMode(
  qtyRaw: string | number | null,
  unit: string | null,
  description: string,
): { mode: QuantityMode; quantity: number | null } {
  const qtyStr = toStr(qtyRaw).toUpperCase()

  // 'RATE ONLY' (case-insensitive)
  if (qtyStr === 'RATE ONLY') {
    return { mode: 'rate_only', quantity: null }
  }

  // Description-based: PROVISIONAL, P.C, PRIME COST
  const descUpper = description.toUpperCase()
  if (/\bPROVISIONAL\b/.test(descUpper)) {
    return { mode: 'provisional', quantity: null }
  }
  if (/PRIME COST/.test(descUpper) || /\bP\.C\b/.test(descUpper)) {
    return { mode: 'pc_sum', quantity: null }
  }

  // lump_sum: unit is 'Sum' (case-insensitive) and no numeric qty
  if (unit != null && unit.trim().toLowerCase() === 'sum') {
    const q = toNum(qtyRaw)
    if (q == null) {
      return { mode: 'lump_sum', quantity: null }
    }
  }

  // Default: measured (numeric qty, or null if blank)
  const quantity = toNum(qtyRaw)
  return { mode: 'measured', quantity }
}

/**
 * Parse a single bill sheet's rows (AoA) into sections and items.
 * Returns empty arrays for non-bill sheets (prose/summary).
 */
export function parseSheet(
  name: string,
  rows: Aoa,
  classification: SheetClassification,
): { sections: ParsedSection[]; items: ParsedItem[] } {
  if (classification.kind !== 'bill') {
    return { sections: [], items: [] }
  }

  const { headerRowIndex, columns, rateModel } = classification
  if (headerRowIndex === -1) {
    return { sections: [], items: [] }
  }

  const sections: ParsedSection[] = []
  const items: ParsedItem[] = []

  let currentSectionTempId: string | null = null
  let sectionSortOrder = 0
  let itemSortOrder = 0

  // Walk every row after the header
  for (let rowIndex = headerRowIndex + 1; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex]

    const itemCode = columns.item !== undefined ? toStr(row[columns.item]) : ''
    const description = columns.description !== undefined ? toStr(row[columns.description]) : ''
    const unitRaw = columns.unit !== undefined ? row[columns.unit] : null
    const unit = unitRaw != null ? toStr(unitRaw) || null : null
    const qtyRaw = columns.qty !== undefined ? row[columns.qty] : null

    const supplyRate = columns.supply !== undefined ? toNum(row[columns.supply]) : null
    const installRate = columns.install !== undefined ? toNum(row[columns.install]) : null
    const rate = columns.rate !== undefined ? toNum(row[columns.rate]) : null
    const amount = columns.amount !== undefined ? toNum(row[columns.amount]) : null

    // Category row: item matches ^[A-Z]+\d+$ with NO qty, NO supply/install/rate,
    // AND no amount. A coded row WITH an amount (e.g. P&G's "A1 … Sum … 1139424")
    // is a lump-sum line item, not a category header — fall through to emit it.
    if (itemCode && CATEGORY_RE.test(itemCode)) {
      const hasQtyOrRate =
        toNum(qtyRaw) != null || supplyRate != null || installRate != null || rate != null

      if (!hasQtyOrRate && amount == null) {
        const tempId = `${name}#${rowIndex}`
        const section: ParsedSection = {
          tempId,
          parentTempId: '',   // caller (parse-boq orchestrator) fills this in
          kind: 'category',
          code: itemCode,
          title: description,
          sortOrder: sectionSortOrder++,
        }
        sections.push(section)
        currentSectionTempId = tempId
        continue
      }
    }

    // Line item row: either a sub-coded row (^[A-Z]+\d+\.\d+) or a coded row
    // (^[A-Z]+\d+$) that carries an amount — i.e. a lump sum (e.g. P&G's
    // "A1 … Sum … 1139424"). The pure-header case already `continue`d above.
    const isLumpSumCodedRow = itemCode != '' && CATEGORY_RE.test(itemCode) && amount != null
    if (itemCode && (ITEM_RE.test(itemCode) || isLumpSumCodedRow)) {
      const { mode: quantityMode, quantity } = resolveQuantityMode(qtyRaw, unit, description)

      const item: ParsedItem = {
        sectionTempId: currentSectionTempId ?? '',
        code: itemCode,
        description,
        unit,
        quantity,
        quantityMode,
        rateModel,
        supplyRate,
        installRate,
        rate,
        amount,
        sortOrder: itemSortOrder++,
      }
      items.push(item)
      continue
    }

    // Rate-note row: text in description but no item code → skip (no emission)
    // (Rows that are truly blank or unrecognised are also skipped.)
  }

  return { sections, items }
}
