import type { ArithmeticError, CheckResult, ParsedTenderWorkbook, TenderReconciliation } from './types'

/** Nearest whole cent, robust to float noise (3204337.8750000005 → 320433788). */
export function toCents(x: number): number {
  return Math.round(x * 100 + (x >= 0 ? 1e-7 : -1e-7))
}

function check(label: string, computedRaw: number, stated: number | null): CheckResult {
  const computed = toCents(computedRaw) / 100
  if (stated == null) return { label, computed, stated: null, differenceCents: null, matched: true }
  const differenceCents = toCents(stated) - toCents(computedRaw)
  return { label, computed, stated, differenceCents, matched: differenceCents === 0 }
}

const norm = (s: string) => s.trim().toUpperCase()

/**
 * Reconcile a parsed tender workbook against its own stated totals, to the cent.
 *
 *  - each sheet: Σ item amounts (raw, rounded once) vs the sheet's carried-forward total
 *  - each summary line: Σ of the sheets carrying that bill code vs the line's amount
 *  - subtotal: Σ of the summary lines' computed values vs the stated ex-VAT subtotal
 *  - line arithmetic: qty × rate vs amount where all three are present (> half a cent off)
 *
 * A figure the workbook does not state cannot be contradicted: it is recorded as a
 * warning, not a mismatch. Anything the parser could not classify fails the whole
 * reconciliation, because an unaccounted price means the totals cannot be trusted.
 */
export function reconcileTender(parsed: ParsedTenderWorkbook): TenderReconciliation {
  const warnings: string[] = []
  const sheetSums = new Map<string, number>()

  const sheets: CheckResult[] = parsed.sheets.map((s) => {
    const sum = s.rows.reduce((acc, r) => (r.kind === 'item' && r.amount != null ? acc + r.amount : acc), 0)
    sheetSums.set(s.name, sum)
    if (s.statedTotal == null) warnings.push(`Sheet "${s.name}" states no total; it cannot be reconciled on its own.`)
    return check(s.name, sum, s.statedTotal)
  })

  const arithmeticErrors: ArithmeticError[] = []
  for (const s of parsed.sheets) {
    for (const r of s.rows) {
      if (r.kind !== 'item' || r.quantity == null || r.rate == null || r.amount == null) continue
      const expected = r.quantity * r.rate
      if (Math.abs(toCents(expected) - toCents(r.amount)) > 0) {
        arithmeticErrors.push({
          sheet: s.name,
          rowNumber: r.rowNumber,
          code: r.code,
          quantity: r.quantity,
          rate: r.rate,
          amount: r.amount,
          expected: toCents(expected) / 100,
        })
      }
    }
  }

  const summaryLines: CheckResult[] = []
  let subtotal: CheckResult | null = null
  const summary = parsed.summary
  if (summary) {
    const claimed = new Set<string>()
    let linesComputed = 0
    for (const line of summary.lines) {
      const owners = parsed.sheets.filter((s) => norm(s.billCode) === norm(line.code))
      if (owners.length === 0) {
        warnings.push(`Summary line ${line.code} (${line.description}) has no matching bill sheet.`)
        summaryLines.push({ label: line.code, computed: 0, stated: line.amount, differenceCents: toCents(line.amount), matched: false })
        continue
      }
      const sum = owners.reduce((acc, s) => acc + (sheetSums.get(s.name) ?? 0), 0)
      owners.forEach((s) => claimed.add(s.name))
      linesComputed += sum
      summaryLines.push(check(line.code, sum, line.amount))
    }
    for (const s of parsed.sheets) {
      if (claimed.has(s.name)) continue
      const sum = sheetSums.get(s.name) ?? 0
      if (toCents(sum) !== 0 || s.statedTotal != null) {
        warnings.push(`Sheet "${s.name}" (bill ${s.billCode}) is priced but the summary has no line for it.`)
        summaryLines.push({ label: `${s.billCode} (no summary line)`, computed: toCents(sum) / 100, stated: null, differenceCents: null, matched: false })
      } else {
        warnings.push(`Sheet "${s.name}" has no summary line (nothing priced on it yet).`)
      }
    }
    subtotal = check('Subtotal excl. VAT', linesComputed, summary.subtotalExVat)
    if (summary.subtotalExVat == null) warnings.push('The summary states no ex-VAT subtotal.')
  } else {
    warnings.push('No summary sheet found; only per-sheet totals were reconciled.')
  }

  for (const name of parsed.skippedSheets) {
    if (parsed.hiddenSheets.includes(name)) warnings.push(`Sheet "${name}" is hidden and was not read.`)
    else if (parsed.skippedPricedSheets.includes(name))
      warnings.push(`Sheet "${name}" was not read (no BOQ header, or a second summary laid out like a bill) but holds numbers; check it is not a bill.`)
    else warnings.push(`Sheet "${name}" was not read (no BOQ header).`)
  }
  for (const s of parsed.sheets) {
    for (const r of s.recapPricedRows) {
      warnings.push(`Sheet "${s.name}" row ${r.rowNumber} ("${r.description}" = ${r.amount}) comes after the bill total and was not counted.`)
    }
  }
  for (const u of parsed.unclassified) {
    warnings.push(`Unclassified priced row ${u.sheet}!${u.rowNumber} "${u.description}" = ${u.amount} (${u.reason}).`)
  }

  const matched =
    parsed.unclassified.length === 0 &&
    parsed.skippedPricedSheets.length === 0 &&
    sheets.every((c) => c.matched) &&
    summaryLines.every((c) => c.matched) &&
    (subtotal?.matched ?? true)

  return { matched, sheets, summaryLines, subtotal, arithmeticErrors, warnings }
}
