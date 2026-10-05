/**
 * Shared formatting helpers for the Rates / BOQ tab.
 *
 * Tender values are in ZAR. `fmtMoney` mirrors the cable-cost module's `fmtZAR`
 * (Intl currency style, en-ZA) for cross-module consistency — e.g.
 * 58724268.76 → "R 58 724 268,76". null/undefined render as an em-dash.
 * `fmtQty` renders a measured quantity (trailing zeros trimmed).
 */

const moneyFmt = new Intl.NumberFormat('en-ZA', {
  style: 'currency',
  currency: 'ZAR',
  maximumFractionDigits: 2,
})

const qtyFmt = new Intl.NumberFormat('en-ZA', {
  minimumFractionDigits: 0,
  maximumFractionDigits: 3,
})

/** Render an amount as ZAR currency (matches the cable-cost fmtZAR); null → em-dash. */
export function fmtMoney(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return moneyFmt.format(value)
}

/**
 * Render a unit rate as a plain ZAR figure: always 2 decimals, a point for the
 * decimal and a regular space between thousands (1234.5 → "1 234.50"). Used
 * where rates sit side by side in a comparison table and the currency is given
 * by the column heading. null/undefined → em-dash.
 */
export function fmtRate(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  const [int, dec] = value.toFixed(2).split('.')
  return `${int.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${dec}`
}

/** Render a measured quantity (up to 3 decimals, trailing zeros trimmed); null → em-dash. */
export function fmtQty(value: number | null | undefined): string {
  if (value === null || value === undefined || Number.isNaN(value)) return '—'
  return qtyFmt.format(value)
}
