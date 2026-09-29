'use client'
/** Annual net cashflow bars with the cumulative cashflow line. */
import { extentWithZero, linearScale, linePath, niceTicks } from './geometry'
import { num } from '../format'

const W = 640, H = 260, L = 64, R = 12, T = 12, B = 28
export function CashflowChart({ title, rows }: { title: string; rows: Array<{ year: number; netZar: number; cumulativeZar: number }> }) {
  const [lo, hi] = extentWithZero([rows.map((r) => r.netZar), rows.map((r) => r.cumulativeZar)])
  const ticks = niceTicks(lo, hi, 4)
  const y = linearScale([ticks[0]!, ticks[ticks.length - 1]!], [H - B, T])
  const bw = (W - L - R) / Math.max(1, rows.length)
  const cx = (i: number) => L + i * bw + bw / 2
  return (
    <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title} style={{ width: '100%', height: 'auto' }}>
      <title>{title}</title>
      {ticks.map((t) => (
        <g key={t}>
          <line x1={L} x2={W - R} y1={y(t)} y2={y(t)} stroke="var(--c-border, #e5e7eb)" />
          <text x={L - 6} y={y(t) + 4} textAnchor="end" fontSize="10">{num(t / 1e6, 1)}</text>
        </g>
      ))}
      <text x={4} y={T + 4} fontSize="10" fill="var(--c-text-dim)">R million</text>
      {rows.map((r, i) => (
        <rect key={r.year} data-year={r.year} x={L + i * bw + bw * 0.15} width={bw * 0.7} y={Math.min(y(r.netZar), y(0))} height={Math.abs(y(r.netZar) - y(0))}
          fill={r.netZar < 0 ? 'var(--c-red, #dc2626)' : 'var(--c-green, #16a34a)'}><title>{`Year ${r.year}: net R ${num(r.netZar, 0)}`}</title></rect>
      ))}
      <path data-series="cumulative" d={linePath(rows.map((r) => r.cumulativeZar), cx, y)} fill="none" stroke="var(--c-amber, #d97706)" strokeWidth={2} />
      {rows.map((r, i) => (i % 5 === 0 ? <text key={r.year} x={cx(i)} y={H - 8} textAnchor="middle" fontSize="10">{r.year}</text> : null))}
    </svg>
  )
}
