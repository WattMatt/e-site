/**
 * Which rows of a long list to render. `last` is EXCLUSIVE (use `rows.slice(first, last)`);
 * both are clamped to [0, rowCount]. An empty list gives { first: 0, last: 0 }.
 */
export function visibleRange(
  scrollTop: number, viewport: number, rowCount: number, rowHeight: number, overscan = 10,
): { first: number; last: number } {
  if (rowCount <= 0 || rowHeight <= 0) return { first: 0, last: 0 }
  const top = Math.max(0, scrollTop)
  const first = Math.min(rowCount, Math.max(0, Math.floor(top / rowHeight) - overscan))
  const last = Math.min(rowCount, Math.max(first, Math.ceil((top + Math.max(0, viewport)) / rowHeight) + overscan))
  return { first, last }
}
