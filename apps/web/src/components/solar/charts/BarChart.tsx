'use client'
/** Hand-rolled SVG grouped bar chart. */
import { extentWithZero, linearScale, niceTicks, SERIES_COLOURS } from './geometry'
import { num } from '../format'

const W = 640, H = 240, L = 48, R = 12, T = 12, B = 28
export function BarChart({ title, unit, groups, seriesLabels }: { title: string; unit: string; groups: Array<{ label: string; values: number[] }>; seriesLabels: string[] }) {
  const [lo, hi] = extentWithZero(groups.map((g) => g.values))
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [H - B, T])
  const gw = (W - L - R) / Math.max(1, groups.length)
  const bw = (gw * 0.8) / Math.max(1, seriesLabels.length)
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
        <title>{title}</title>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" />
            <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--c-text-dim)">{num(t, 0)}</text>
          </g>
        ))}
        <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">{unit}</text>
        {groups.map((g, gi) => (
          <g key={g.label}>
            {g.values.map((v, si) => (
              <rect key={si} data-bar="" x={L + gi * gw + gw * 0.1 + si * bw} width={bw} y={Math.min(y(v), y(0))} height={Math.abs(y(v) - y(0))} fill={SERIES_COLOURS[si % SERIES_COLOURS.length]}>
                <title>{`${g.label} — ${seriesLabels[si] ?? ''}: ${num(v, 1)} ${unit}`}</title>
              </rect>
            ))}
            <text x={L + gi * gw + gw / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--c-text-dim)">{g.label}</text>
          </g>
        ))}
      </svg>
      <figcaption style={{ display: 'flex', flexWrap: 'wrap', gap: 12, fontSize: 12 }}>
        {seriesLabels.map((s, k) => <span key={s}><span aria-hidden style={{ display: 'inline-block', width: 10, height: 10, background: SERIES_COLOURS[k % SERIES_COLOURS.length], marginRight: 4 }} />{s}</span>)}
      </figcaption>
    </figure>
  )
}
