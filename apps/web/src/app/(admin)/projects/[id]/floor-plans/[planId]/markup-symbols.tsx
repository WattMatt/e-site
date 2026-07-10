/**
 * IEC 60617 / SANS-style electrical symbol library for floor-plan markup.
 *
 * Each symbol is a set of neutral drawing ELEMENTS defined in a 0..100 box, so
 * the SAME definition renders on the Konva canvas (mapped in MarkupCanvas) and
 * as an SVG thumbnail in the picker (SymbolSvg here) — single source of truth.
 * Adding a symbol is just another registry entry; nothing else changes.
 */

import type { ReactNode } from 'react'

export type SymbolEl =
  | { t: 'line'; pts: number[] } // flat [x0,y0,x1,y1,…] polyline in 0..100
  | { t: 'circle'; cx: number; cy: number; r: number; fill?: boolean }
  | { t: 'path'; d: string; fill?: boolean } // SVG path data in 0..100
  | { t: 'text'; x: number; y: number; w: number; h: number; s: string; size: number }

export type SymbolKind =
  | 'db'
  | 'socket'
  | 'switch'
  | 'luminaire'
  | 'isolator'
  | 'earth'
  | 'conduit'
  | 'motor'

export const SYMBOLS: Record<SymbolKind, { label: string; els: SymbolEl[] }> = {
  db: {
    label: 'Distribution board',
    els: [
      { t: 'path', d: 'M18,26 L82,26 L82,74 L18,74 Z' },
      { t: 'text', x: 18, y: 26, w: 64, h: 48, s: 'DB', size: 30 },
    ],
  },
  socket: {
    label: 'Socket outlet',
    els: [
      { t: 'line', pts: [20, 62, 80, 62] },
      { t: 'path', d: 'M20,62 A30,30 0 0 1 80,62' },
      { t: 'line', pts: [50, 62, 50, 82] },
    ],
  },
  switch: {
    label: 'Switch (1-way)',
    els: [
      { t: 'line', pts: [50, 84, 50, 60] },
      { t: 'circle', cx: 50, cy: 56, r: 4, fill: true },
      { t: 'line', pts: [50, 56, 76, 34] },
    ],
  },
  luminaire: {
    label: 'Luminaire / light',
    els: [
      { t: 'circle', cx: 50, cy: 50, r: 26 },
      { t: 'line', pts: [31, 31, 69, 69] },
      { t: 'line', pts: [69, 31, 31, 69] },
    ],
  },
  isolator: {
    label: 'Isolator',
    els: [
      { t: 'line', pts: [50, 16, 50, 42] },
      { t: 'line', pts: [50, 42, 74, 62] }, // open knife contact
      { t: 'circle', cx: 50, cy: 66, r: 2.5, fill: true },
      { t: 'line', pts: [50, 66, 50, 86] },
    ],
  },
  earth: {
    label: 'Earth / ground',
    els: [
      { t: 'line', pts: [50, 20, 50, 48] },
      { t: 'line', pts: [30, 48, 70, 48] },
      { t: 'line', pts: [37, 59, 63, 59] },
      { t: 'line', pts: [44, 70, 56, 70] },
    ],
  },
  conduit: {
    label: 'Conduit run',
    els: [
      { t: 'line', pts: [14, 50, 86, 50] },
      { t: 'line', pts: [46, 42, 54, 58] },
      { t: 'line', pts: [53, 42, 61, 58] },
      { t: 'line', pts: [60, 42, 68, 58] },
    ],
  },
  motor: {
    label: 'Motor',
    els: [
      { t: 'circle', cx: 50, cy: 50, r: 28 },
      { t: 'text', x: 22, y: 22, w: 56, h: 56, s: 'M', size: 36 },
    ],
  },
}

export const SYMBOL_KINDS = Object.keys(SYMBOLS) as SymbolKind[]

/** SVG thumbnail of a symbol for the picker. Stroke inherits `color`. */
export function SymbolSvg({
  kind,
  color = 'currentColor',
  size = 34,
}: {
  kind: SymbolKind
  color?: string
  size?: number
}): ReactNode {
  const def = SYMBOLS[kind]
  return (
    <svg
      viewBox="0 0 100 100"
      width={size}
      height={size}
      fill="none"
      stroke={color}
      strokeWidth={6}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      {def.els.map((el, i) => {
        if (el.t === 'line') {
          return <polyline key={i} points={el.pts.join(' ')} />
        }
        if (el.t === 'circle') {
          return <circle key={i} cx={el.cx} cy={el.cy} r={el.r} fill={el.fill ? color : 'none'} />
        }
        if (el.t === 'path') {
          return <path key={i} d={el.d} fill={el.fill ? color : 'none'} />
        }
        return (
          <text
            key={i}
            x={el.x + el.w / 2}
            y={el.y + el.h / 2}
            fontSize={el.size}
            fill={color}
            stroke="none"
            textAnchor="middle"
            dominantBaseline="central"
            fontFamily="ui-sans-serif, system-ui, sans-serif"
            fontWeight="600"
          >
            {el.s}
          </text>
        )
      })}
    </svg>
  )
}
