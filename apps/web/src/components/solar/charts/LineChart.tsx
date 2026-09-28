'use client'
/** Hand-rolled SVG line chart (E-Site has no charting library). Draws what geometry.ts returns. */
import { extentWithZero, linearScale, linePath, niceTicks, SERIES_COLOURS } from './geometry'
import { num } from '../format'

export interface LineSeries { label: string; values: number[] }
const W = 640, H = 240, L = 48, R = 12, T = 12, B = 28

export function LineChart({ title, unit, xLabels, series, height = H }: { title: string; unit: string; xLabels: string[]; series: LineSeries[]; height?: number }) {
  const [lo, hi] = extentWithZero(series.map((s) => s.values))
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [height - B, T])
  const n = Math.max(1, ...series.map((s) => s.values.length))
  const x = linearScale([0, Math.max(1, n - 1)], [L, W - R])
  const every = Math.max(1, Math.ceil(xLabels.length / 12))
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${height}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--c-text-dim)">{num(t, 0)}</text>
          </g>
        ))}
        {xLabels.map((lab, i) => (i % every === 0 ? <text key={i} x={x(i)} y={height - 8} textAnchor="middle" fontSize="10" fill="var(--c-text-dim)">{lab}</text> : null))}
        <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">{unit}</text>
        {series.map((s, k) => (
          <path key={s.label} data-series={s.label} d={linePath(s.values, x, y)} fill="none" stroke={SERIES_COLOURS[k % SERIES_COLOURS.length]} strokeWidth={1.8} />
        ))}
      </svg>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
        {series.map((s, k) => (
          <span key={s.label}><span aria-hidden style={{ display: 'inline-block', width: 10, height: 3, background: SERIES_COLOURS[k % SERIES_COLOURS.length], marginRight: 4, verticalAlign: 'middle' }} />{s.label}</span>
        ))}
      </figcaption>
    </figure>
  )
}
