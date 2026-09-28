'use client'
/** Sensitivity tornado: a low and a high bar per variable, centred on the base NPV. */
import { linearScale, tornadoLayout } from './geometry'
import { rand } from '../format'

export interface TornadoBarView { variable: string; label: string; lowNpvZar: number; highNpvZar: number; spreadZar: number }
const W = 640, ROW = 28, L = 150, R = 20
export function TornadoChart({ title, baseNpvZar, bars }: { title: string; baseNpvZar: number; bars: TornadoBarView[] }) {
  const { rows, domain } = tornadoLayout(baseNpvZar, bars)
  const x = linearScale(domain, [L, W - R])
  const H = rows.length * ROW + 30
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      <line x1={x(baseNpvZar)} x2={x(baseNpvZar)} y1={0} y2={H - 20} stroke="var(--c-text-dim)" />
      <text x={x(baseNpvZar)} y={H - 6} textAnchor="middle" fontSize="10">Base NPV {rand(baseNpvZar)}</text>
      {rows.map((b, i) => {
        const y = i * ROW + 4
        const lowX = x(Math.min(b.lowNpvZar, baseNpvZar)), lowW = Math.abs(x(b.lowNpvZar) - x(baseNpvZar))
        const highX = x(Math.min(b.highNpvZar, baseNpvZar)), highW = Math.abs(x(b.highNpvZar) - x(baseNpvZar))
        return (
          <g key={b.variable}>
            <text x={L - 8} y={y + 15} textAnchor="end" fontSize="11">{b.label}</text>
            <rect data-side="low" x={lowX} width={lowW} y={y} height={ROW - 8} fill="var(--c-blue, #2563eb)"><title>{`${b.label} −20 %: ${rand(b.lowNpvZar)}`}</title></rect>
            <rect data-side="high" x={highX} width={highW} y={y} height={ROW - 8} fill="var(--c-amber, #d97706)" opacity={0.8}><title>{`${b.label} +20 %: ${rand(b.highNpvZar)}`}</title></rect>
          </g>
        )
      })}
    </svg>
  )
}
