/**
 * Natural / alphanumeric string comparison.
 *
 * Plain `String.localeCompare` (or a DB `ORDER BY text`) sorts "DB-10" before
 * "DB-2" because the character '1' < '2'. Board codes need numeric-aware
 * ordering so "DB-2" comes before "DB-10". `Intl.Collator({ numeric: true })`
 * does exactly that; `sensitivity: 'base'` makes it case-insensitive.
 *
 * Backs the Equipment Schedule and Materials board ordering.
 */
const collator = new Intl.Collator(undefined, { numeric: true, sensitivity: 'base' })

export function naturalCompare(a: string, b: string): number {
  return collator.compare(a, b)
}
