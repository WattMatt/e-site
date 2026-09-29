/** Display helpers for Solar screens. Deterministic: no ICU, no locale. */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const SAST_OFFSET_MS = 2 * 60 * 60 * 1000 // South Africa has no DST

/** "28 Sep 2026" in Africa/Johannesburg. Empty string for an unparseable value. */
export function formatSolarDate(iso: string): string {
  const t = Date.parse(iso)
  if (Number.isNaN(t)) return ''
  const d = new Date(t + SAST_OFFSET_MS)
  return `${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`
}

/** Whole rand with comma thousands: 199900 kobo → "R1,999". */
export function formatRandWhole(kobo: number): string {
  const rands = Math.round(kobo / 100)
  return 'R' + String(rands).replace(/\B(?=(\d{3})+(?!\d))/g, ',')
}

/** ["Ann","Ben","Cy"] → "Ann, Ben and Cy". */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names[0] ?? ''
  return `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`
}
