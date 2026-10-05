import type { DiffChange, DiffRowRef, ParsedTenderRow, ParsedTenderWorkbook, TenderBoqDiff } from './types'

/** Key items by sheet + code, with an occurrence counter so a repeated code is not collapsed. */
function index(p: ParsedTenderWorkbook): Map<string, ParsedTenderRow> {
  const out = new Map<string, ParsedTenderRow>()
  for (const s of p.sheets) {
    const seen = new Map<string, number>()
    for (const r of s.rows) {
      if (r.kind !== 'item') continue
      const id = r.code ?? `desc:${r.description.toUpperCase()}`
      const n = (seen.get(id) ?? 0) + 1
      seen.set(id, n)
      out.set(`${s.name}\u0000${id}\u0000${n}`, r)
    }
  }
  return out
}

const ref = (r: ParsedTenderRow): DiffRowRef => ({ sheet: r.sheet, code: r.code, description: r.description })

/**
 * Structural diff of two parsed tender BOQs, item rows only. Used two ways:
 * the issued tender vs the PRE-PRICED INTERNAL copy (must be identical), and one
 * revision vs the next (R8 → R9). Rates and amounts are deliberately ignored;
 * only what a tenderer may not change is compared.
 */
export function diffTenderBoqs(before: ParsedTenderWorkbook, after: ParsedTenderWorkbook): TenderBoqDiff {
  const a = index(before)
  const b = index(after)
  const added: DiffRowRef[] = []
  const removed: DiffRowRef[] = []
  const changed: DiffChange[] = []

  for (const [key, ra] of a) {
    const rb = b.get(key)
    if (!rb) {
      removed.push(ref(ra))
      continue
    }
    if (ra.description !== rb.description)
      changed.push({ sheet: ra.sheet, code: ra.code, field: 'description', before: ra.description, after: rb.description })
    if ((ra.unit ?? '') !== (rb.unit ?? ''))
      changed.push({ sheet: ra.sheet, code: ra.code, field: 'unit', before: ra.unit, after: rb.unit })
    if (ra.quantity !== rb.quantity)
      changed.push({ sheet: ra.sheet, code: ra.code, field: 'quantity', before: ra.quantity, after: rb.quantity })
  }
  for (const [key, rb] of b) if (!a.has(key)) added.push(ref(rb))

  return { identical: added.length + removed.length + changed.length === 0, added, removed, changed }
}
