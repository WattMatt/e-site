'use client'
/** Loss waterfall (horizontal): start/subtotal/end bars from zero, losses stepping down. */
import { linearScale, niceTicks, waterfallBars } from './geometry'
import { num } from '../format'

export interface Step { key: string; label: string; kwh: number; kind: 'start' | 'loss' | 'subtotal' | 'end' }
const W = 640, ROW = 26, L = 250, R = 70
export function WaterfallChart({ title, steps }: { title: string; steps: Step[] }) {
  const bars = waterfallBars(steps)
  const max = Math.max(1, ...steps.map((s) => s.kwh))
  const ticks = niceTicks(0, max, 4)
  const x = linearScale([0, ticks[ticks.length - 1]!], [L, W - R])
  const H = steps.length * ROW + 20
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      {steps.map((s, i) => (
        <g key={s.key}>
          <text x={L - 8} y={i * ROW + 17} textAnchor="end" fontSize="11">{s.label}</text>
          <rect data-step={s.key} x={x(bars[i]!.from)} width={Math.max(1, x(bars[i]!.to) - x(bars[i]!.from))} y={i * ROW + 5} height={ROW - 10}
            fill={s.kind === 'loss' ? 'var(--c-red, #dc2626)' : 'var(--c-amber, #d97706)'} />
          <text x={W - R + 4} y={i * ROW + 17} fontSize="11">{s.kind === 'loss' ? '−' : ''}{num(s.kwh / 1000, 1)} MWh</text>
        </g>
      ))}
    </svg>
  )
}
