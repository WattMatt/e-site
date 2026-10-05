/** Per-item rate statistics. Pure. */

export interface RatePoint { rate: number; pricedOn: string }

export interface RateStats {
  n: number
  min: number | null
  median: number | null
  p75: number | null
  max: number | null
  latest: RatePoint | null
}

/** Linear-interpolated percentile (same as Excel PERCENTILE.INC). `p` in [0, 1]. */
export function percentile(values: number[], p: number): number | null {
  if (!values.length) return null
  const s = [...values].sort((a, b) => a - b)
  const pos = p * (s.length - 1)
  const lo = Math.floor(pos), hi = Math.ceil(pos)
  return s[lo] + (s[hi] - s[lo]) * (pos - lo)
}

export function rateStats(points: RatePoint[]): RateStats {
  if (!points.length) return { n: 0, min: null, median: null, p75: null, max: null, latest: null }
  const v = points.map(p => p.rate)
  const latest = points.reduce((a, b) => (b.pricedOn > a.pricedOn ? b : a))
  return {
    n: points.length, min: Math.min(...v), median: percentile(v, 0.5), p75: percentile(v, 0.75), max: Math.max(...v),
    latest: { rate: latest.rate, pricedOn: latest.pricedOn },
  }
}
