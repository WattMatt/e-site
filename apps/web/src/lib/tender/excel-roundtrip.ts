import type { ParsedTenderWorkbook } from './types'

/** A stored BOQ row as the bidder portal exposes it. */
export interface StoredRow {
  id: string
  sheet_name: string
  row_number: number
  kind: string
  code: string | null
  description: string
  unit: string | null
  quantity: number | null
  rate_cell_type: string | null
}

export interface LockedCellChange {
  sheet: string
  rowNumber: number
  code: string | null
  field: 'missing row' | 'added row' | 'code' | 'description' | 'unit' | 'quantity'
  expected: string | number | null
  found: string | number | null
}

export interface RoundTripResult {
  /** True when no locked cell changed; rates may then be saved. */
  ok: boolean
  changes: LockedCellChange[]
  /** Rates read from the bidder's copy, for priced and rate-only items. */
  rates: { itemId: string; rate: number | null }[]
  /** The bidder's own amount differs from quantity × rate (we recompute; this is only reported). */
  arithmetic: { sheet: string; rowNumber: number; code: string | null; theirs: number; ours: number }[]
  /** A rate typed into a fixed-sum row is ignored. */
  ignoredFixedRates: { sheet: string; rowNumber: number; code: string | null }[]
}

const norm = (s: string | null | undefined) => (s ?? '').replace(/\s+/g, ' ').trim()
const cents = (x: number) => Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))
const sameQty = (a: number | null, b: number | null) =>
  a == null || b == null ? a == null && b == null : Math.abs(a - b) <= 1e-6 * Math.max(1, Math.abs(a))

/**
 * Compare a bidder's priced copy with the BOQ as issued, cell by cell, and lift
 * the rates out of it. Rows are matched by sheet + Excel row number (the
 * addresses stored at import), so a moved, deleted or edited item is caught.
 * Only item rows are checked: headings and notes may be re-formatted freely.
 */
export function compareUploadedBoq(stored: StoredRow[], uploaded: ParsedTenderWorkbook): RoundTripResult {
  const byCell = new Map<string, ParsedTenderWorkbook['sheets'][number]['rows'][number]>()
  for (const s of uploaded.sheets) for (const r of s.rows) byCell.set(`${s.name}\u0000${r.rowNumber}`, r)

  const changes: LockedCellChange[] = []
  const rates: RoundTripResult['rates'] = []
  const arithmetic: RoundTripResult['arithmetic'] = []
  const ignoredFixedRates: RoundTripResult['ignoredFixedRates'] = []

  for (const item of stored) {
    if (item.kind !== 'item') continue
    const got = byCell.get(`${item.sheet_name}\u0000${item.row_number}`)
    const at = { sheet: item.sheet_name, rowNumber: item.row_number, code: item.code }
    if (!got || got.kind !== 'item') {
      changes.push({ ...at, field: 'missing row', expected: item.description, found: got ? got.description : null })
      continue
    }
    if (norm(got.code) !== norm(item.code)) changes.push({ ...at, field: 'code', expected: item.code, found: got.code })
    if (norm(got.description) !== norm(item.description)) changes.push({ ...at, field: 'description', expected: item.description, found: got.description })
    if (norm(got.unit) !== norm(item.unit)) changes.push({ ...at, field: 'unit', expected: item.unit, found: got.unit })
    if (!sameQty(got.quantity, item.quantity == null ? null : Number(item.quantity)))
      changes.push({ ...at, field: 'quantity', expected: item.quantity, found: got.quantity })

    if (item.rate_cell_type === 'fixed') {
      if (got.rate != null) ignoredFixedRates.push(at)
      continue
    }
    const rate = got.rate
    rates.push({ itemId: item.id, rate })
    if (rate != null && got.amount != null && item.quantity != null && item.rate_cell_type === 'priced') {
      const ours = cents(Number(item.quantity) * rate) / 100
      if (cents(got.amount) !== cents(ours)) arithmetic.push({ ...at, theirs: got.amount, ours })
    }
  }
  // An item the bidder ADDED (no stored item at that address) changes the BOQ.
  const storedItemCells = new Set(stored.filter((i) => i.kind === 'item').map((i) => `${i.sheet_name}\u0000${i.row_number}`))
  for (const s of uploaded.sheets) {
    for (const r of s.rows) {
      if (r.kind === 'item' && !storedItemCells.has(`${s.name}\u0000${r.rowNumber}`)) {
        changes.push({ sheet: s.name, rowNumber: r.rowNumber, code: r.code, field: 'added row', expected: null, found: r.description })
      }
    }
  }
  return { ok: changes.length === 0, changes, rates, arithmetic, ignoredFixedRates }
}
