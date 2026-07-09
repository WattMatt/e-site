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
