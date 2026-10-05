/** ZAR with a space thousands separator and two decimals: 1 234.50. "—" for nothing. */
export function zar(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(Number(n))) return '—'
  const [i, d] = Number(n).toFixed(2).split('.')
  return `${i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${d}`
}

export const SA_PROVINCES = [
  'Eastern Cape', 'Free State', 'Gauteng', 'KwaZulu-Natal', 'Limpopo', 'Mpumalanga', 'North West', 'Northern Cape', 'Western Cape',
] as const

/** Query-string helper for filter links that keeps the other filters. */
export function qs(params: Record<string, string | undefined>): string {
  const u = new URLSearchParams()
  for (const [k, v] of Object.entries(params)) if (v) u.set(k, v)
  const s = u.toString()
  return s ? `?${s}` : ''
}
