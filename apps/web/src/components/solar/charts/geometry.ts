/** Pure SVG geometry for the Solar charts (tested; the components only draw what this returns). */
export function linearScale([d0, d1]: [number, number], [r0, r1]: [number, number]) {
  const span = d1 - d0
  return (v: number) => (span === 0 ? r0 : r0 + ((v - d0) / span) * (r1 - r0))
}

export function niceTicks(min: number, max: number, count = 5): number[] {
  if (!(max > min)) return [min]
  const raw = (max - min) / count
  const mag = 10 ** Math.floor(Math.log10(raw))
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw)!
  const start = Math.floor(min / step) * step
  const out: number[] = []
  for (let v = start; v <= max + step * 1e-9 || out.length === 0 || out[out.length - 1]! < max; v += step) {
    out.push(Math.round(v / step) * step)
  }
  return out
}

export function extentWithZero(series: number[][]): [number, number] {
  const all = series.flat().filter(Number.isFinite)
  if (all.length === 0) return [0, 1]
  let lo = 0, hi = 0
  for (const v of all) { if (v < lo) lo = v; if (v > hi) hi = v }
  return hi === lo ? [lo, lo + 1] : [lo, hi]
}

const r2 = (v: number) => Math.round(v * 100) / 100
export function linePath(values: number[], x: (i: number) => number, y: (v: number) => number): string {
  return values.map((v, i) => `${i === 0 ? 'M' : 'L'}${r2(x(i))},${r2(y(v))}`).join('')
}

export function waterfallBars(steps: Array<{ kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }>): Array<{ from: number; to: number }> {
  let level = 0
  return steps.map((s) => {
    if (s.kind === 'loss') { const b = { from: level - s.kwh, to: level }; level -= s.kwh; return b }
    level = s.kwh
    return { from: 0, to: s.kwh }
  })
}

export function tornadoLayout<T extends { lowNpvZar: number; highNpvZar: number; spreadZar: number }>(base: number, bars: T[]) {
  const rows = [...bars].sort((a, b) => b.spreadZar - a.spreadZar)
  const vals = rows.flatMap((b) => [b.lowNpvZar, b.highNpvZar]).concat(base)
  return { rows, domain: [Math.min(...vals), Math.max(...vals)] as [number, number] }
}

export const SERIES_COLOURS = ['var(--c-amber, #d97706)', 'var(--c-blue, #2563eb)', 'var(--c-green, #16a34a)', 'var(--c-red, #dc2626)', 'var(--c-violet, #7c3aed)'] as const
