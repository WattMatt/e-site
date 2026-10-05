/** "R 3 204 337.88" — space-grouped like the rest of E-Site's money. */
export function formatRand(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—'
  const sign = n < 0 ? '-' : ''
  const [whole, cents] = Math.abs(n).toFixed(2).split('.')
  return `${sign}R ${whole.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')}.${cents}`
}

export function tenderStatusVariant(status: string): 'default' | 'ghost' | 'info' | 'warning' | 'success' | 'danger' {
  switch (status) {
    case 'draft': return 'ghost'
    case 'issued': return 'info'
    case 'closed': return 'warning'
    case 'adjudicated': return 'success'
    case 'cancelled': return 'danger'
    default: return 'default'
  }
}

export const RATE_CELL_TYPE_LABELS: Record<string, string> = {
  priced: 'Priced (rate × qty)',
  fixed: 'Fixed sum (set by WM)',
  rate_only: 'Rate only',
  not_priced: 'May be left blank',
}
