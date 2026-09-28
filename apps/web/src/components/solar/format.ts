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
