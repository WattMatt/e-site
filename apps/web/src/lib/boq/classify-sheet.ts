import type { Aoa, ColumnMap, SheetClassification } from './types'
import type { RateModel } from '@esite/shared'

// Header cell aliases to normalise before column mapping
const ALIASES: Record<string, string> = {
  ITEA: 'ITEM',
  'SUPPLY RATE': 'SUPPLY',
  'INSTALL RATE': 'INSTALL',
}

function normaliseCell(raw: string | number | null): string {
  if (raw == null) return ''
  const s = String(raw).trim().toUpperCase()
  return ALIASES[s] ?? s
}

/**
 * Classify a spreadsheet by name + content, returning kind, header row index,
 * column map, and rate model.
 *
 * For prose/summary sheets the header row and columns are empty stubs (kind
 * is the only meaningful field).
 */
export function classifySheet(name: string, rows: Aoa): SheetClassification {
  // 1. Prose check (by name)
  if (/NOTES TO TENDERER|QUALIFICATIONS/i.test(name)) {
    return { kind: 'prose', headerRowIndex: -1, columns: {}, rateModel: 'amount_only' }
  }

  // 2. Summary check (by name)
  if (/MAIN SUMMARY|MALL SUMMARY/i.test(name)) {
    return { kind: 'summary', headerRowIndex: -1, columns: {}, rateModel: 'amount_only' }
  }

  // 3. Bill sheet — find the header row (first row containing a cell ≈ 'DESCRIPTION')
  let headerRowIndex = -1
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]
    if (row.some(cell => normaliseCell(cell) === 'DESCRIPTION')) {
      headerRowIndex = i
      break
    }
  }

  // If we cannot find a header row, treat as prose/unknown
  if (headerRowIndex === -1) {
    return { kind: 'prose', headerRowIndex: -1, columns: {}, rateModel: 'amount_only' }
  }

  // 4. Map logical fields to column indices
  const headerRow = rows[headerRowIndex]
  const columns: ColumnMap = {}

  const fieldMap: Record<string, keyof ColumnMap> = {
    ITEM: 'item',
    DESCRIPTION: 'description',
    UNIT: 'unit',
    QTY: 'qty',
    QUANTITY: 'qty',
    SUPPLY: 'supply',
    INSTALL: 'install',
    RATE: 'rate',
    AMOUNT: 'amount',
  }

  for (let col = 0; col < headerRow.length; col++) {
    const norm = normaliseCell(headerRow[col])
    const field = fieldMap[norm]
    if (field && columns[field] === undefined) {
      columns[field] = col
    }
  }

  // 5. Determine rateModel
  let rateModel: RateModel
  if (columns.supply !== undefined && columns.install !== undefined) {
    rateModel = 'supply_install'
  } else if (columns.rate !== undefined) {
    rateModel = 'single'
  } else {
    rateModel = 'amount_only'
  }

  return { kind: 'bill', headerRowIndex, columns, rateModel }
}
