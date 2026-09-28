/**
 * Locale-free number formatting for Solar reports and proposals. The PDF (react-pdf, WinAnsi) and
 * the client page both call these, so a figure is the same byte string in both — never
 * `toLocaleString`, whose output differs between Node and browsers (narrow no-break spaces).
 * Output is printable ASCII only.
 */
const group = (digits: string) => digits.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')

export function fixed(n: number, dp: number): string {
  if (!Number.isFinite(n)) return 'n/a'
  const [w, f] = Math.abs(n).toFixed(dp).split('.')
  const isZero = Number(`${w}.${f ?? '0'}`) === 0
  return `${n < 0 && !isZero ? '-' : ''}${group(w!)}${f ? `.${f}` : ''}`
}

const money = (n: number, dp: number) => (Number.isFinite(n) ? `${n < 0 ? '-' : ''}R ${fixed(Math.abs(n), dp)}` : 'n/a')
export const zar = (n: number): string => money(n, 0)
export const zarCents = (n: number): string => money(n, 2)
export const pct = (fraction: number | null, dp = 1): string =>
  fraction === null || !Number.isFinite(fraction) ? 'n/a' : `${fixed(fraction * 100, dp)} %`
export const mwh = (kwh: number): string => `${fixed(kwh / 1000, 1)} MWh`
export const kwp = (v: number): string => `${fixed(v, 1)} kWp`
export const kw = (v: number): string => `${fixed(v, 1)} kW`
export const years = (y: number | null): string => (y === null || !Number.isFinite(y) ? 'n/a' : `${fixed(y, 1)} years`)
export const isoDate = (iso: string): string => iso.slice(0, 10)
