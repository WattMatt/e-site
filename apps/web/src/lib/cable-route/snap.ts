/**
 * Vertex snapping while tracing a cable route.
 *
 * Two rules, both pure:
 *  · The FIRST vertex of a leg snaps to a nearby endpoint of a leg already
 *    saved on this sheet, so the legs of one run visibly join instead of
 *    landing a few pixels apart.
 *  · With Shift held, any LATER vertex is constrained to 0/45/90° from the
 *    previous one — cable trays run orthogonally, and a freehand click rarely
 *    lands on the axis.
 */

export type SnapResult = { point: [number, number]; snappedTo: 'endpoint' | 'angle' | null }

export function snapRouteVertex(
  candidate: [number, number],
  previous: [number, number] | null,
  endpoints: ReadonlyArray<[number, number]>,
  tolerance: number,
  shift: boolean,
): SnapResult {
  if (previous == null) {
    let best: [number, number] | null = null
    let bestD = tolerance
    for (const e of endpoints) {
      const d = Math.hypot(e[0] - candidate[0], e[1] - candidate[1])
      if (d <= bestD) { best = e; bestD = d }
    }
    return best ? { point: [best[0], best[1]], snappedTo: 'endpoint' } : { point: candidate, snappedTo: null }
  }
  if (!shift) return { point: candidate, snappedTo: null }
  const dx = candidate[0] - previous[0]
  const dy = candidate[1] - previous[1]
  const dist = Math.hypot(dx, dy)
  if (dist === 0) return { point: candidate, snappedTo: null }
  const step = Math.PI / 4
  const ang = Math.round(Math.atan2(dy, dx) / step) * step
  return { point: [previous[0] + Math.cos(ang) * dist, previous[1] + Math.sin(ang) * dist], snappedTo: 'angle' }
}
