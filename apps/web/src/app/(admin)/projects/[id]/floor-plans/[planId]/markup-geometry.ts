/**
 * Pure geometry + style helpers for the floor-plan markup canvas.
 *
 * Extracted from MarkupCanvas.tsx so the precision-drawing maths (angle snap,
 * dash arrays) is unit-testable without pulling in react-konva / pdfjs / a
 * real <canvas>. No React, no Konva, no DOM — keep it that way.
 */

export type StrokeStyle = 'solid' | 'dashed' | 'dotted'

export const STROKE_STYLES: Array<{ value: StrokeStyle; label: string }> = [
  { value: 'solid', label: 'Solid' },
  { value: 'dashed', label: 'Dashed' },
  { value: 'dotted', label: 'Dotted' },
]

/**
 * Konva stroke dash array for a given style, scaled by stroke width so a dotted
 * 8px line still reads as dots (not a dashed line). Solid → undefined.
 */
export function dashFor(style: StrokeStyle, strokeWidth: number): number[] | undefined {
  if (style === 'dashed') return [strokeWidth * 3 + 4, strokeWidth * 2 + 3]
  if (style === 'dotted') return [Math.max(1, strokeWidth * 0.6), strokeWidth * 2 + 2]
  return undefined
}

/**
 * Snap the endpoint (x,y) to the nearest 0°/45°/90° from the anchor (x0,y0),
 * preserving the drag distance. Used for Shift-constrained line + arrow so a
 * user can draw clean orthogonals and true diagonals.
 */
export function snapAngle(x0: number, y0: number, x: number, y: number): [number, number] {
  const dx = x - x0
  const dy = y - y0
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return [x, y]
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return [x0 + Math.cos(ang) * dist, y0 + Math.sin(ang) * dist]
}

/** Grid line spacing in *image pixels* for a desired real-world spacing.
 *  Uses calibration (px per metre) when available; otherwise falls back to a
 *  plain pixel grid so the aid still works on an uncalibrated drawing. */
export function gridSpacingPx(
  gridSpacingM: number,
  pixelsPerMeter: number | null,
  fallbackPx = 50,
): number {
  if (pixelsPerMeter && pixelsPerMeter > 0 && gridSpacingM > 0) {
    return gridSpacingM * pixelsPerMeter
  }
  return fallbackPx
}

/** Round a coordinate to the nearest grid line. No-op for a non-positive
 *  spacing (guards divide-by-zero). */
export function snapToGrid(value: number, spacingPx: number): number {
  if (!(spacingPx > 0)) return value
  return Math.round(value / spacingPx) * spacingPx
}

/** Grid line offsets across [0, extent] at the given spacing, capped at
 *  `maxLines` so a fine grid on a huge raster can't spawn thousands of nodes
 *  (returns [] when it would exceed the cap — caller hides the grid). */
export function gridLineOffsets(extent: number, spacingPx: number, maxLines = 400): number[] {
  if (!(spacingPx > 0) || !(extent > 0)) return []
  const count = Math.floor(extent / spacingPx)
  if (count > maxLines) return []
  const out: number[] = []
  for (let i = 0; i <= count; i++) out.push(i * spacingPx)
  return out
}

// ── Hit-testing (click-to-select + eraser) ────────────────────────────────

/** Shortest distance from point (px,py) to the segment (ax,ay)-(bx,by). */
export function pointSegmentDistance(
  px: number, py: number, ax: number, ay: number, bx: number, by: number,
): number {
  const dx = bx - ax
  const dy = by - ay
  const len2 = dx * dx + dy * dy
  if (len2 === 0) return Math.hypot(px - ax, py - ay)
  let t = ((px - ax) * dx + (py - ay) * dy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy))
}

/** Min distance from (px,py) to a flat [x0,y0,x1,y1,…] polyline. When
 *  `closed`, the closing segment (last→first) is included. Infinity for <2 pts. */
export function distToPolyline(px: number, py: number, pts: number[], closed = false): number {
  if (pts.length < 4) {
    return pts.length >= 2 ? Math.hypot(px - pts[0]!, py - pts[1]!) : Infinity
  }
  let min = Infinity
  for (let i = 0; i + 3 < pts.length; i += 2) {
    min = Math.min(min, pointSegmentDistance(px, py, pts[i]!, pts[i + 1]!, pts[i + 2]!, pts[i + 3]!))
  }
  if (closed) {
    const n = pts.length
    min = Math.min(min, pointSegmentDistance(px, py, pts[n - 2]!, pts[n - 1]!, pts[0]!, pts[1]!))
  }
  return min
}

/** Ray-casting point-in-polygon for a flat [x0,y0,…] ring. */
export function pointInPolygon(px: number, py: number, pts: number[]): boolean {
  let inside = false
  const n = pts.length / 2
  for (let i = 0, j = n - 1; i < n; j = i++) {
    const xi = pts[i * 2]!, yi = pts[i * 2 + 1]!
    const xj = pts[j * 2]!, yj = pts[j * 2 + 1]!
    if (yi > py !== yj > py && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

/** Point within an axis-aligned rect expanded by `pad`. */
export function rectContains(
  px: number, py: number, x: number, y: number, w: number, h: number, pad = 0,
): boolean {
  const x0 = Math.min(x, x + w) - pad
  const x1 = Math.max(x, x + w) + pad
  const y0 = Math.min(y, y + h) - pad
  const y1 = Math.max(y, y + h) + pad
  return px >= x0 && px <= x1 && py >= y0 && py <= y1
}

/** Point within an ellipse (centre cx,cy, radii rx,ry) expanded by `pad`. */
export function ellipseContains(
  px: number, py: number, cx: number, cy: number, rx: number, ry: number, pad = 0,
): boolean {
  const a = rx + pad
  const b = ry + pad
  if (a <= 0 || b <= 0) return false
  const nx = (px - cx) / a
  const ny = (py - cy) / b
  return nx * nx + ny * ny <= 1
}

// ── Transform baking (move / scale / rotate) ──────────────────────────────

/** Scale a flat point list about anchor (ox,oy). */
export function scalePointsAbout(pts: number[], sx: number, sy: number, ox: number, oy: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) {
    out.push(ox + (pts[i]! - ox) * sx, oy + (pts[i + 1]! - oy) * sy)
  }
  return out
}

/** Rotate a flat point list by `angleRad` about anchor (ox,oy). */
export function rotatePointsAbout(pts: number[], angleRad: number, ox: number, oy: number): number[] {
  const cos = Math.cos(angleRad)
  const sin = Math.sin(angleRad)
  const out: number[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) {
    const dx = pts[i]! - ox
    const dy = pts[i + 1]! - oy
    out.push(ox + dx * cos - dy * sin, oy + dx * sin + dy * cos)
  }
  return out
}

/** Translate a flat point list by (dx,dy). */
export function translatePoints(pts: number[], dx: number, dy: number): number[] {
  const out: number[] = []
  for (let i = 0; i + 1 < pts.length; i += 2) out.push(pts[i]! + dx, pts[i + 1]! + dy)
  return out
}

/**
 * Bake a Konva node transform into a flat point list: scale about the origin,
 * then rotate by `rotDeg`, then translate to (nx,ny). This exactly reconstructs
 * Konva's node transform T(nx,ny)∘R(rotDeg)∘S(sx,sy) applied to points rendered
 * at the node origin (0,0) — the invariant the markup Transformer bake relies
 * on. Kept here so the composition order is unit-tested (see the .test file).
 */
export function bakePointTransform(
  points: number[],
  sx: number,
  sy: number,
  rotDeg: number,
  nx: number,
  ny: number,
): number[] {
  let p = scalePointsAbout(points, sx, sy, 0, 0)
  p = rotatePointsAbout(p, (rotDeg * Math.PI) / 180, 0, 0)
  return translatePoints(p, nx, ny)
}

/**
 * Symbol size (px) from a Konva node's ABSOLUTE scale after a Transformer
 * gesture. The symbol Group is rendered pre-scaled by size/100 (its local box
 * is 0..100), so at any moment the rendered width === 100 × scale. We therefore
 * bake the absolute scale directly (NOT oldSize × scale — that double-counts the
 * base 0.46-ish scale and collapses the glyph on every rotate/resize). Averaged
 * across both axes (symbols scale uniformly) and clamped to a minimum.
 */
export function symbolSizeFromScale(scaleX: number, scaleY: number, min = 16): number {
  return Math.max(min, ((scaleX + scaleY) / 2) * 100)
}

// ── Legend / table operations (pure, on a rows[][] grid) ──────────────────
// Row 0 is the header. Removals keep at least a 1×1 grid.

export function tableAddRow(rows: string[][]): string[][] {
  const cols = rows[0]?.length ?? 1
  return [...rows, Array(cols).fill('')]
}
export function tableAddCol(rows: string[][]): string[][] {
  return rows.length ? rows.map((r) => [...r, '']) : [['']]
}
export function tableRemoveRow(rows: string[][]): string[][] {
  return rows.length > 1 ? rows.slice(0, -1) : rows
}
export function tableRemoveCol(rows: string[][]): string[][] {
  return (rows[0]?.length ?? 0) > 1 ? rows.map((r) => r.slice(0, -1)) : rows
}
export function tableSetCell(rows: string[][], r: number, c: number, value: string): string[][] {
  return rows.map((row, ri) => (ri === r ? row.map((cell, ci) => (ci === c ? value : cell)) : row))
}

/** Readable text colour (near-black or white) for a #rrggbb background, chosen
 *  by relative luminance — used for sticky-note text on any note colour. */
export function contrastText(hex: string): '#111827' | '#ffffff' {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex)
  if (!m) return '#111827'
  const n = parseInt(m[1]!, 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  // Relative luminance (sRGB, simple coefficients).
  const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
  return lum > 0.6 ? '#111827' : '#ffffff'
}
