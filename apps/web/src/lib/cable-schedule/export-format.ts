/**
 * Shared numeric formatting for the cable-schedule text exporters (CSV, PDF).
 * Single null convention: null / undefined / non-finite → '' (empty string).
 * Excel uses ExcelJS numFmt codes instead, so it doesn't consume this.
 */

/** Format a number to `dp` decimals (rounded). Empty string for null/non-finite. */
export function formatDecimal(value: number | null | undefined, dp = 0): string {
  if (value == null || !Number.isFinite(value)) return ''
  return dp > 0 ? value.toFixed(dp) : Math.round(value).toString()
}
