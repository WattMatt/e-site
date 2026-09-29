export interface LinearScale { (v: number): number; invert: (p: number) => number }

export function linear(domain: [number, number], range: [number, number]): LinearScale {
  const [d0, d1] = domain
  const [r0, r1] = range
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  const f = ((v: number) => r0 + (v - d0) * k) as LinearScale
  f.invert = (p: number) => (k === 0 ? d0 : d0 + (p - r0) / k)
  return f
}

/** Round tick values covering [min, max] with about `count` steps (1/2/5 × 10^n). */
export function niceTicks(min: number, max: number, count: number): number[] {
  if (!(Number.isFinite(min) && Number.isFinite(max))) return [0, 1]
  if (min === max) { min -= 1; max += 1 }
  const raw = (max - min) / Math.max(1, count)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= raw) as number
  const start = Math.floor(min / step) * step
  const end = Math.ceil(max / step) * step
  const out: number[] = []
  for (let v = start; v <= end + step / 2; v += step) out.push(Number(v.toFixed(10)))
  return out
}

export function formatNumber(v: number, dp = 0): string {
  const s = v.toFixed(dp)
  const [i, f] = s.split('.')
  const grouped = i.replace(/\B(?=(\d{3})+(?!\d))/g, ' ')
  return f ? `${grouped}.${f}` : grouped
}
