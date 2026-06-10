'use client'

/**
 * Time–current coordination (TCC) plot — log-log SVG. Ported from the verified
 * MV Protection Studio sandbox (src/plot/TccPlot.tsx + scales.ts).
 *
 * The sandbox used d3-scale's `scaleLog`; e-site does NOT depend on d3-scale and
 * this port deliberately avoids adding it (per the Phase 5 spec). The log axis
 * maths are reimplemented inline with `Math.log10` — `logScale` is the direct
 * equivalent of `scaleLog().domain([min,max]).range([lo,hi])`, and `decadeTicks`
 * is copied verbatim (it already only used Math.log10/Math.pow).
 *
 * Pure presentational component: feed it `series` (each a device's parametric
 * IEC/IEEE curve sampled via `tccSeries` from @esite/shared) and optional
 * vertical fault-current `markers`. Renders the "sandbox — not for issue"
 * governance context from the caller, not here.
 */

import type { TccPoint } from '@esite/shared'

export interface TccSeries {
  label: string
  color: string
  points: TccPoint[]
}
export interface TccMarker {
  label: string
  currentA: number
  color?: string
}

interface Props {
  series: TccSeries[]
  markers?: TccMarker[]
  width?: number
  height?: number
}

const fmt = (v: number) => (v >= 1000 ? `${v / 1000}k` : `${v}`)
const trunc = (s: string) => (s.length > 22 ? `${s.slice(0, 21)}…` : s)
const dlo = (v: number) => Math.pow(10, Math.floor(Math.log10(v)))
const dhi = (v: number) => Math.pow(10, Math.ceil(Math.log10(v)))

/**
 * Inline log scale — replaces d3 `scaleLog().domain([min,max]).range([lo,hi])`.
 * Returns a mapper from a domain value to a pixel position. `min`/`max` must be
 * positive (callers pass decade-snapped bounds).
 */
function logScale(min: number, max: number, lo: number, hi: number): (v: number) => number {
  const dMin = Math.log10(min)
  const span = Math.log10(max) - dMin || 1 // guard a single-decade/degenerate domain
  return (v: number) => lo + ((Math.log10(v) - dMin) / span) * (hi - lo)
}

/** Power-of-ten tick values spanning the decades that contain [min, max]. */
function decadeTicks(min: number, max: number): number[] {
  if (!(min > 0) || !(max > 0)) return []
  const lo = Math.floor(Math.log10(min))
  const hi = Math.ceil(Math.log10(max))
  const ticks: number[] = []
  for (let e = lo; e <= hi; e++) ticks.push(Math.pow(10, e))
  return ticks
}

export function TccPlot({ series, markers = [], width = 720, height = 460 }: Props) {
  const padL = 60
  const padR = 176
  const padT = 20
  const padB = 48

  const allA = [
    ...series.flatMap((s) => s.points.map((p) => p.currentA)),
    ...markers.map((m) => m.currentA),
  ].filter((v) => v > 0)
  const allS = series.flatMap((s) => s.points.map((p) => p.timeS)).filter((v) => v > 0 && v <= 100)

  const minA = allA.length ? Math.min(...allA) : 10
  const maxA = allA.length ? Math.max(...allA) : 10000
  const minS = allS.length ? Math.min(...allS) : 0.01
  const maxS = allS.length ? Math.max(...allS) : 10

  // Current → x (left→right); time → y (inverted so small times sit at the top).
  const x = logScale(dlo(minA), dhi(maxA), padL, width - padR)
  const y = logScale(dlo(minS), dhi(maxS), height - padB, padT)
  const xTicks = decadeTicks(minA, maxA)
  const yTicks = decadeTicks(minS, maxS)

  const path = (pts: TccPoint[]) =>
    pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.currentA).toFixed(1)},${y(p.timeS).toFixed(1)}`).join(' ')

  const cx = (padL + (width - padR)) / 2
  const cy = (padT + (height - padB)) / 2

  return (
    <svg
      width={width}
      height={height}
      role="img"
      aria-label="Time-current coordination plot (log-log)"
      style={{ background: '#fff', border: '1px solid #e3e6ea', borderRadius: 10, maxWidth: '100%' }}
    >
      <defs>
        <clipPath id="tcc-plot">
          <rect x={padL} y={padT} width={width - padL - padR} height={height - padT - padB} />
        </clipPath>
      </defs>

      {xTicks.map((t) => (
        <g key={`x${t}`}>
          <line x1={x(t)} x2={x(t)} y1={padT} y2={height - padB} stroke="#eef0f3" />
          <text x={x(t)} y={height - padB + 16} textAnchor="middle" fontSize="11" fill="#6b7280">{fmt(t)}</text>
        </g>
      ))}
      {yTicks.map((t) => (
        <g key={`y${t}`}>
          <line x1={padL} x2={width - padR} y1={y(t)} y2={y(t)} stroke="#eef0f3" />
          <text x={padL - 8} y={y(t) + 4} textAnchor="end" fontSize="11" fill="#6b7280">{fmt(t)}</text>
        </g>
      ))}

      <rect x={padL} y={padT} width={width - padL - padR} height={height - padT - padB} fill="none" stroke="#d8dbe0" />
      <text x={cx} y={height - 6} textAnchor="middle" fontSize="12" fill="#1f2933">Current (A)</text>
      <text x={16} y={cy} textAnchor="middle" fontSize="12" fill="#1f2933" transform={`rotate(-90 16 ${cy})`}>Time (s)</text>

      <g clipPath="url(#tcc-plot)">
        {markers.map((m) => (
          <g key={m.label}>
            <line x1={x(m.currentA)} x2={x(m.currentA)} y1={padT} y2={height - padB} stroke={m.color ?? '#b91c1c'} strokeDasharray="4 3" strokeWidth="1.5" />
            <text x={x(m.currentA) + 4} y={padT + 12} fontSize="10" fill={m.color ?? '#b91c1c'}>{m.label}</text>
          </g>
        ))}
        {series.map((s) => (
          <path key={s.label} d={path(s.points)} fill="none" stroke={s.color} strokeWidth="2" />
        ))}
      </g>

      {series.map((s, i) => (
        <g key={`L${s.label}`} transform={`translate(${width - padR + 12},${padT + 12 + i * 20})`}>
          <line x1="0" x2="18" y1="0" y2="0" stroke={s.color} strokeWidth="3" />
          <text x="24" y="4" fontSize="11" fill="#1f2933">{trunc(s.label)}</text>
        </g>
      ))}
    </svg>
  )
}
