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
