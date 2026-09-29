'use client'
import { useState } from 'react'
import { AXIS_TEXT, GRID } from './palette'
import { formatNumber, linear, niceTicks } from './scale'

export interface BarSeries { key: string; label: string; colour: string; values: number[] }
const W = 800
const M = { l: 64, r: 12, t: 12, b: 28 }

export function BarChart({ title, categories, series, yUnit, height = 260 }: { title: string; categories: string[]; series: BarSeries[]; yUnit: string; height?: number }) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const visible = series.filter((s) => !hidden.has(s.key))
  const yt = niceTicks(0, Math.max(1, ...visible.flatMap((s) => s.values)), 5)
  const ys = linear([0, yt[yt.length - 1]], [height - M.b, M.t])
  const band = (W - M.l - M.r) / Math.max(1, categories.length)
  const bw = (band * 0.8) / Math.max(1, visible.length)
  return (
    <div>
      <svg data-chart role="img" aria-label={title} viewBox={`0 0 ${W} ${height}`} style={{ width: '100%', height: 'auto', display: 'block' }}>
        {yt.map((t) => (
          <g key={t}>
            <line x1={M.l} x2={W - M.r} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeOpacity={0.3} />
            <text x={M.l - 6} y={ys(t) + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>{formatNumber(t)}</text>
          </g>
        ))}
        <text x={4} y={M.t + 4} fontSize={11} fill={AXIS_TEXT}>{yUnit}</text>
        {categories.map((c, i) => (
          <g key={c}>
            <text x={M.l + band * i + band / 2} y={height - 8} fontSize={11} textAnchor="middle" fill={AXIS_TEXT}>{c}</text>
            {visible.map((s, k) => (
              <rect key={s.key} data-bar x={M.l + band * i + band * 0.1 + k * bw} y={ys(s.values[i] ?? 0)} width={bw} height={Math.max(0, ys(0) - ys(s.values[i] ?? 0))} fill={s.colour}>
                <title>{`${c}: ${formatNumber(s.values[i] ?? 0)} ${yUnit}`}</title>
              </rect>
            ))}
          </g>
        ))}
      </svg>
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 8, fontSize: 12 }}>
          {series.map((s) => (
            <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)} onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
              style={{ background: 'none', border: 'none', cursor: 'pointer', opacity: hidden.has(s.key) ? 0.4 : 1, color: 'var(--c-text-mid)' }}>
              <span style={{ width: 10, height: 10, background: s.colour, display: 'inline-block', marginRight: 4 }} />{s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
