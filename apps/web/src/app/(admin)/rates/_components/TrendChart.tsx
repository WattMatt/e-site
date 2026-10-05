import { zar } from '@/lib/rate-library/format'

export interface TrendPoint { date: string; nominal: number; escalated: number | null; label: string }

/**
 * Rates over time, server-rendered SVG (no chart library). Filled dots are in
 * today's money (CPI-escalated); hollow dots are as priced. The observation
 * table below the chart carries every value, so the chart is never the only
 * way to read a number.
 */
export function TrendChart({ points, unit }: { points: TrendPoint[]; unit: string }) {
  if (!points.length) return null
  const W = 640, H = 220, L = 64, R = 16, T = 12, B = 32
  const t = (d: string) => new Date(`${d}T00:00:00Z`).getTime()
  const xs = points.map(p => t(p.date))
  let x0 = Math.min(...xs), x1 = Math.max(...xs)
  if (x0 === x1) { x0 -= 15 * 864e5; x1 += 15 * 864e5 }
  const yMax = Math.max(...points.flatMap(p => [p.nominal, p.escalated ?? 0])) * 1.1 || 1
  const sx = (v: number) => L + ((v - x0) / (x1 - x0)) * (W - L - R)
  const sy = (v: number) => H - B - (v / yMax) * (H - T - B)
  const iso = (ms: number) => new Date(ms).toISOString().slice(0, 7)
  return (
    <figure style={{ margin: 0 }}>
      <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" aria-label={`Rate per ${unit} over time`} style={{ maxWidth: W, display: 'block' }}>
        <line x1={L} y1={H - B} x2={W - R} y2={H - B} stroke="var(--c-border)" />
        <line x1={L} y1={T} x2={L} y2={H - B} stroke="var(--c-border)" />
        {[0, 0.5, 1].map(f => (
          <g key={f}>
            <line x1={L} x2={W - R} y1={sy(yMax * f / 1.1)} y2={sy(yMax * f / 1.1)} stroke="var(--c-border)" strokeDasharray="2 4" opacity={0.6} />
            <text x={L - 6} y={sy(yMax * f / 1.1) + 4} textAnchor="end" fontSize="11" fill="var(--c-text-dim)">{zar(yMax * f / 1.1)}</text>
          </g>
        ))}
        <text x={L} y={H - 10} fontSize="11" fill="var(--c-text-dim)">{iso(x0)}</text>
        <text x={W - R} y={H - 10} fontSize="11" textAnchor="end" fill="var(--c-text-dim)">{iso(x1)}</text>
        {points.map((p, i) => (
          <g key={i}>
            <circle cx={sx(t(p.date))} cy={sy(p.nominal)} r={5} fill="none" stroke="var(--c-text-dim)" strokeWidth={1.5}>
              <title>{`${p.label}: ${zar(p.nominal)} as priced (${p.date})`}</title>
            </circle>
            {p.escalated !== null ? (
              <circle cx={sx(t(p.date))} cy={sy(p.escalated)} r={4} fill="var(--c-amber)">
                <title>{`${p.label}: ${zar(p.escalated)} in today's money`}</title>
              </circle>
            ) : null}
          </g>
        ))}
      </svg>
      <figcaption style={{ color: 'var(--c-text-dim)', fontSize: 12, marginTop: 4 }}>
        <span style={{ color: 'var(--c-amber)' }}>●</span> today&apos;s money (CPI) &nbsp; ○ as priced — rate per {unit}, ZAR excl. VAT
      </figcaption>
    </figure>
  )
}
