/** Display formatting only (no result is computed here). Units are always shown (spec §0.4 rule 3). */
function signed(x: number, dp: number): { neg: boolean; text: string } {
  const [i, d] = Math.abs(x).toFixed(dp).split('.')
  const g = i!.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  const text = d ? `${g}.${d}` : g
  // A value that rounds to zero is not signed ("−0.0" reads as a real negative).
  return { neg: x < 0 && Number(Math.abs(x).toFixed(dp)) !== 0, text }
}

export const num = (x: number, dp = 1) => { const s = signed(x, dp); return `${s.neg ? '−' : ''}${s.text}` }
export const rand = (zar: number, dp = 0) => { const s = signed(zar, dp); return `${s.neg ? '−' : ''}R ${s.text}` }
export const mwh = (kwh: number) => `${num(kwh / 1000, 1)} MWh`
export const kw = (x: number) => `${num(x, 1)} kW`
export const pct = (fraction: number, dp = 1) => `${num(fraction * 100, dp)} %`
export const years = (y: number | null) => (y === null ? 'n/a' : `${num(y, 1)} years`)

/**
 * A stored timestamp in SAST (UTC+2, no daylight saving) — deterministic on the server and in the
 * browser, so a client component renders the same text in both (no hydration mismatch).
 */
export function sastDateTime(iso: string | null | undefined): string {
  const t = iso ? Date.parse(iso) : Number.NaN
  if (!Number.isFinite(t)) return '—'
  return `${new Date(t + 2 * 3600_000).toISOString().slice(0, 16).replace('T', ' ')} SAST`
}
export const sastDate = (iso: string | null | undefined): string => (sastDateTime(iso) === '—' ? '—' : sastDateTime(iso).slice(0, 10))
