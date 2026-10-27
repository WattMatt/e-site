/**
 * Drawn line work → image space (spec §5).
 *
 * A DB block on a 300 schematic is a 7-row table drawn with vector lines. The
 * detector finds the block by its text; the table's own border is where the
 * box belongs (snap-blocks.ts). This module turns one straight path segment,
 * already in PDF user space, into an axis-aligned line on the scale-2 raster.
 * The caller passes the CTM composed with the viewport transform, which
 * carries the page's /Rotate, exactly as text-space.ts does.
 */
import type { Matrix } from './text-space'

/** One horizontal (y = at) or vertical (x = at) line in image space, from < to. */
export interface LineSegment {
  axis: 'h' | 'v'
  at: number
  from: number
  to: number
}

/** A line counts as axis-aligned when its off-axis drift is at most this share of its length. */
const MAX_SKEW = 0.01

export function segmentToImageSpace(
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  m: Matrix,
): LineSegment | null {
  const ax = m[0] * x1 + m[2] * y1 + m[4]
  const ay = m[1] * x1 + m[3] * y1 + m[5]
  const bx = m[0] * x2 + m[2] * y2 + m[4]
  const by = m[1] * x2 + m[3] * y2 + m[5]
  if (![ax, ay, bx, by].every(Number.isFinite)) return null
  const dx = Math.abs(bx - ax)
  const dy = Math.abs(by - ay)
  if (dx === 0 && dy === 0) return null
  if (dy <= MAX_SKEW * dx) return { axis: 'h', at: (ay + by) / 2, from: Math.min(ax, bx), to: Math.max(ax, bx) }
  if (dx <= MAX_SKEW * dy) return { axis: 'v', at: (ax + bx) / 2, from: Math.min(ay, by), to: Math.max(ay, by) }
  return null
}
