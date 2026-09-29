'use client'
import { useMemo, useRef, useState, type MouseEvent } from 'react'
import { AXIS_TEXT, GAP_FILL, GRID } from './palette'
import { formatNumber, linear, niceTicks } from './scale'

export interface LinePoint { x: number; y: number | null }
export interface LineSeries {
  key: string
  label: string
  colour: string
  points: LinePoint[]
  band?: Array<{ x: number; lo: number | null; hi: number | null }>
}
export interface LineChartProps {
  title: string
  series: LineSeries[]
  yUnit: string
  xFormat: (x: number) => string
  height?: number
  gaps?: Array<{ from: number; to: number }>
  /** Drag across the plot to choose a range (the meter chart zooms with it). */
  onSelectRange?: (from: number, to: number) => void
}

const W = 800
const M = { l: 56, r: 12, t: 12, b: 28 }

function pathOf(pts: LinePoint[], x: (v: number) => number, y: (v: number) => number): string {
  let d = ''
  let pen = false
  for (const p of pts) {
    if (p.y === null || !Number.isFinite(p.y)) { pen = false; continue }
    d += `${pen ? 'L' : 'M'}${x(p.x).toFixed(1)},${y(p.y).toFixed(1)}`
    pen = true
  }
  return d
}

export function LineChart({ title, series, yUnit, xFormat, height = 280, gaps = [], onSelectRange }: LineChartProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set())
  const [hover, setHover] = useState<number | null>(null)
  const [drag, setDrag] = useState<{ x0: number; x1: number } | null>(null)
  const svgRef = useRef<SVGSVGElement | null>(null)
  const visible = series.filter((s) => !hidden.has(s.key))

  const { xs, ys, xTicks, yTicks } = useMemo(() => {
    const allX = series.flatMap((s) => s.points.map((p) => p.x))
    const allY = visible.flatMap((s) => [...s.points.map((p) => p.y), ...(s.band ?? []).flatMap((b) => [b.lo, b.hi])]).filter((v): v is number => v !== null && Number.isFinite(v))
    const x0 = allX.length ? Math.min(...allX) : 0
    const x1 = allX.length ? Math.max(...allX) : 1
    const yt = niceTicks(allY.length ? Math.min(0, ...allY) : 0, allY.length ? Math.max(...allY) : 1, 5)
    const xsc = linear([x0, x1 === x0 ? x0 + 1 : x1], [M.l, W - M.r])
    const ysc = linear([yt[0], yt[yt.length - 1]], [height - M.b, M.t])
    const xt = Array.from({ length: 6 }, (_, i) => x0 + ((x1 - x0) * i) / 5)
    return { xs: xsc, ys: ysc, xTicks: xt, yTicks: yt }
  }, [series, visible, height])

  const toX = (e: MouseEvent<SVGSVGElement>) => {
    const r = svgRef.current?.getBoundingClientRect()
    const px = r && r.width > 0 ? ((e.clientX - r.left) / r.width) * W : M.l
    return xs.invert(Math.max(M.l, Math.min(W - M.r, px)))
  }
  const nearest = (s: LineSeries, x: number) => {
    let best: LinePoint | null = null
    for (const p of s.points) if (p.y !== null && (!best || Math.abs(p.x - x) < Math.abs(best.x - x))) best = p
    return best
  }

  return (
    <div>
      <svg
        ref={svgRef}
        data-chart
        role="img"
        aria-label={title}
        viewBox={`0 0 ${W} ${height}`}
        style={{ width: '100%', height: 'auto', display: 'block', touchAction: 'none' }}
        onMouseMove={(e) => { const x = toX(e); setHover(x); if (drag) setDrag({ ...drag, x1: x }) }}
        onMouseLeave={() => { setHover(null); setDrag(null) }}
        onMouseDown={(e) => { if (onSelectRange) { const x = toX(e); setDrag({ x0: x, x1: x }) } }}
        onMouseUp={() => {
          if (drag && onSelectRange && Math.abs(xs(drag.x1) - xs(drag.x0)) > 8) onSelectRange(Math.min(drag.x0, drag.x1), Math.max(drag.x0, drag.x1))
          setDrag(null)
        }}
      >
        {yTicks.map((t) => (
          <g key={`y${t}`}>
            <line x1={M.l} x2={W - M.r} y1={ys(t)} y2={ys(t)} stroke={GRID} strokeOpacity={0.3} />
            <text x={M.l - 6} y={ys(t) + 4} fontSize={11} textAnchor="end" fill={AXIS_TEXT}>{formatNumber(t, Math.abs(t) < 10 && t % 1 !== 0 ? 1 : 0)}</text>
          </g>
        ))}
        <text x={4} y={M.t + 4} fontSize={11} fill={AXIS_TEXT}>{yUnit}</text>
        {xTicks.map((t, i) => (
          <text key={`x${i}`} x={xs(t)} y={height - 8} fontSize={11} textAnchor={i === 0 ? 'start' : i === 5 ? 'end' : 'middle'} fill={AXIS_TEXT}>{xFormat(t)}</text>
        ))}
        {gaps.map((g, i) => (
          <rect key={`g${i}`} data-gap x={xs(g.from)} y={M.t} width={Math.max(1, xs(g.to) - xs(g.from))} height={height - M.t - M.b} fill={GAP_FILL} fillOpacity={0.18} />
        ))}
        {visible.map((s) => s.band && (
          <path key={`b${s.key}`} data-band={s.key} fill={s.colour} fillOpacity={0.18} stroke="none"
            d={(() => {
              const pts = s.band.filter((b) => b.lo !== null && b.hi !== null) as Array<{ x: number; lo: number; hi: number }>
              if (pts.length === 0) return ''
              const top = pts.map((b, i) => `${i ? 'L' : 'M'}${xs(b.x).toFixed(1)},${ys(b.hi).toFixed(1)}`).join('')
              const bottom = [...pts].reverse().map((b) => `L${xs(b.x).toFixed(1)},${ys(b.lo).toFixed(1)}`).join('')
              return `${top}${bottom}Z`
            })()} />
        ))}
        {visible.map((s) => <path key={s.key} data-series={s.key} d={pathOf(s.points, xs, ys)} fill="none" stroke={s.colour} strokeWidth={1.5} />)}
        {drag && <rect x={xs(Math.min(drag.x0, drag.x1))} y={M.t} width={Math.abs(xs(drag.x1) - xs(drag.x0))} height={height - M.t - M.b} fill="#2563eb" fillOpacity={0.1} />}
        {hover !== null && <line x1={xs(hover)} x2={xs(hover)} y1={M.t} y2={height - M.b} stroke={AXIS_TEXT} strokeDasharray="3 3" />}
      </svg>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12, marginTop: 4 }}>
        {series.map((s) => (
          <button key={s.key} type="button" aria-pressed={!hidden.has(s.key)}
            onClick={() => setHidden((h) => { const n = new Set(h); if (n.has(s.key)) n.delete(s.key); else n.add(s.key); return n })}
            style={{ display: 'inline-flex', alignItems: 'center', gap: 4, background: 'none', border: 'none', cursor: 'pointer', color: 'var(--c-text-mid)', opacity: hidden.has(s.key) ? 0.4 : 1 }}>
            <span style={{ width: 10, height: 10, borderRadius: 2, background: s.colour, display: 'inline-block' }} />{s.label}
          </button>
        ))}
        {hover !== null && (
          <span style={{ marginLeft: 'auto', fontFamily: 'var(--font-mono)', color: 'var(--c-text)' }}>
            {xFormat(hover)} · {visible.map((s) => { const p = nearest(s, hover); return p && p.y !== null ? `${s.label} ${formatNumber(p.y, 2)} ${yUnit}` : null }).filter(Boolean).join(' · ')}
          </span>
        )}
      </div>
    </div>
  )
}
