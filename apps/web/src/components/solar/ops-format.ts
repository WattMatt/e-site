/** Locale-free formatting for the Operations tab (toLocaleString differs between Node and browsers). */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function kwh(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  const r = Math.round(v)
  return `${r < 0 ? '-' : ''}${group(String(Math.abs(r)))}`
}

export function pctSigned(v: number | null | undefined): string {
  if (v === null || v === undefined || !Number.isFinite(v)) return '—'
  return `${v > 0 ? '+' : ''}${v.toFixed(1)} %`
}

export function sastDateTime(iso: string): string {
  return new Date(Date.parse(iso) + 2 * 3_600_000).toISOString().slice(0, 16).replace('T', ' ')
}
