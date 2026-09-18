/**
 * Cable route measurement — pure maths for tracing a run on a calibrated
 * drawing and turning it into a length.
 *
 * Runtime-agnostic: no React, no Konva, no DOM, no Supabase. The canvas calls
 * these, the server actions call these, and the legend renderer calls these, so
 * a length can never differ depending on which of the three produced it.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHY A SEGMENT CARRIES ITS OWN CALIBRATION
 * ─────────────────────────────────────────────────────────────────────────────
 * The markup canvas already ships a measure tool. Its `MeasureShape` stores only
 * `points` (MarkupCanvas.tsx:104) and the metre readout is recomputed at render
 * from the drawing's CURRENT `pixels_per_meter` (:1888-1897). Recalibrating a
 * drawing therefore silently rewrites every measurement ever taken on it, with
 * no record that anything changed.
 *
 * That is tolerable for a scratch dimension. It is not tolerable for a cable
 * length, which is written onto a schedule, issued, frozen by a database
 * trigger and built from. So a route segment stores the calibration that was in
 * force when it was traced, and the metres that calibration produced. Neither is
 * ever recomputed. If the drawing is later recalibrated,
 * `isSegmentCalibrationStale` raises a flag and a human decides whether to
 * re-measure. Nothing moves under a signature.
 *
 * ─────────────────────────────────────────────────────────────────────────────
 * WHAT A ROUTE IS
 * ─────────────────────────────────────────────────────────────────────────────
 * A run's drawings are single sheets (POWER LAYOUT PORTION A … PORTION J), so a
 * feed from a main board to a distant board leaves the sheet it starts on. A
 * route is therefore an ORDERED LIST OF SEGMENTS, one per sheet crossed, and its
 * length is the sum of them plus the vertical allowances.
 *
 *     total = Σ segment.length_m + rise_m + drop_m
 *
 * The polyline gives the horizontal route only. Rise and drop are typed by the
 * measurer per run, so a cable that climbs 3.5m up a wall and drops 0.5m into a
 * board carries those as explicit, auditable numbers rather than buried in a
 * percentage nobody can take apart later.
 */

/** Metres are stored and compared at centimetre precision. */
const METRE_DP = 2

/**
 * Round to centimetre precision, killing binary floating-point dust on the way.
 * Every value that leaves this module goes through here, so two paths that
 * compute the same length cannot disagree in the 15th decimal place and render
 * as different numbers.
 */
export function roundMetres(m: number): number {
  const f = 10 ** METRE_DP
  // The +Number.EPSILON nudge makes exact .005 cases round half-up rather than
  // down, which is what a person reading a tape measure expects.
  return Math.round((m + Number.EPSILON) * f) / f
}

/**
 * Validate a flat `[x1,y1,x2,y2,…]` point array.
 * Returns an error message, or null when the polyline is usable.
 */
export function validateRoutePoints(points: readonly number[]): string | null {
  if (points.length % 2 !== 0) return 'Route points must be x,y pairs.'
  if (points.length < 4) return 'A route needs at least two points.'
  for (const v of points) {
    if (!Number.isFinite(v)) return 'Route points must all be finite numbers.'
  }
  return null
}

/**
 * Length of a polyline in drawing pixels, walked leg by leg.
 *
 * ⚠ This sums the legs. It is NOT the distance from the first point to the
 * last. On an L-shaped route those differ by the whole point of the feature:
 * a cable follows the route drawn, not the straight line to its destination.
 */
export function polylineLengthPx(points: readonly number[]): number {
  const err = validateRoutePoints(points)
  if (err) throw new Error(err)
  let total = 0
  for (let i = 0; i + 3 < points.length; i += 2) {
    total += Math.hypot(points[i + 2] - points[i], points[i + 3] - points[i + 1])
  }
  return total
}

/**
 * Derive a drawing's calibration from a line the user drew across something
 * whose real length they know.
 *
 * Mirrors the existing `saveCalibration` in MarkupCanvas so a drawing
 * calibrated through this flow is identical to one calibrated through the
 * markup toolbar, and the two can never disagree about the same sheet.
 */
export function derivePixelsPerMeter(points: readonly number[], realMetres: number): number {
  const err = validateRoutePoints(points)
  if (err) throw new Error(err)
  if (!(realMetres > 0)) throw new Error('Calibration distance must be greater than zero metres.')
  const px = polylineLengthPx(points)
  if (px <= 0) throw new Error('Calibration needs two distinct points.')
  return px / realMetres
}

/**
 * Metres for one traced segment, at the calibration supplied.
 *
 * The caller passes the calibration explicitly rather than this function
 * reaching for the drawing's current value, because the value that matters is
 * the one in force when the trace was made. See the module header.
 */
export function segmentLengthM(points: readonly number[], pixelsPerMeter: number): number {
  if (!(pixelsPerMeter > 0)) {
    throw new Error('Cannot measure without a positive calibration (pixels per metre).')
  }
  return roundMetres(polylineLengthPx(points) / pixelsPerMeter)
}

/** The part of a stored segment the total needs. */
export interface RouteSegmentForTotal {
  length_m: number
}

export interface RouteTotalInput {
  segments: readonly RouteSegmentForTotal[]
  riseM: number
  dropM: number
}

/**
 * A run's full length: every sheet it crosses, plus the vertical allowances.
 *
 * Allowances of zero are normal and are not an error — plenty of runs are flat.
 * NEGATIVE allowances are refused, because the only thing they could do is
 * silently shorten a run, and a cable ordered short is scrap.
 */
export function routeTotalM(input: RouteTotalInput): number {
  const { segments, riseM, dropM } = input
  if (riseM < 0 || dropM < 0) {
    throw new Error('Rise and drop cannot be negative.')
  }
  let total = riseM + dropM
  for (const s of segments) total += s.length_m
  return roundMetres(total)
}

/** The part of a stored segment the staleness check needs. */
export interface SegmentCalibration {
  pixels_per_meter: number
}

/**
 * Has the drawing been recalibrated since this segment was traced?
 *
 * True means the stored metres and the drawing no longer agree, so the segment
 * should be offered for re-measurement. It does NOT mean the stored value is
 * wrong, and nothing recomputes it automatically — see the module header.
 *
 * A drawing with no current calibration returns false: nothing has contradicted
 * the measurement, so there is nothing to flag.
 */
export function isSegmentCalibrationStale(
  segment: SegmentCalibration,
  planPixelsPerMeter: number | null | undefined,
): boolean {
  if (planPixelsPerMeter == null || !(planPixelsPerMeter > 0)) return false
  // Relative tolerance: calibration is a derived float, and two runs calibrated
  // from the same drawn line can differ in the last bits without meaning
  // anything. Only a real recalibration should raise the flag.
  const diff = Math.abs(segment.pixels_per_meter - planPixelsPerMeter)
  return diff > Math.max(1e-6, Math.abs(planPixelsPerMeter) * 1e-9)
}

// ─────────────────────────────────────────────────────────────────────────────
// PER-EDGE GEOMETRY — what the canvas labels while you trace and after you save.
// ─────────────────────────────────────────────────────────────────────────────
// A leg's stored length is the whole path rounded once (`segmentLengthM`). The
// labels are each edge rounded separately, so their sum may differ from the
// stored figure by up to half a cent per edge. That is the honest number to
// print beside each edge; the stored figure is the honest number to sign. The
// test suite pins the bound so the two formulas cannot drift apart.

/** One vertex-to-vertex piece of a polyline, with where to hang its label. */
export interface PolylineEdge {
  x1: number
  y1: number
  x2: number
  y2: number
  /** Pixel length of this edge alone. */
  px: number
  midX: number
  midY: number
}

/** Split a flat [x1,y1,x2,y2,…] polyline into its edges. Empty below two points. */
export function polylineEdges(points: readonly number[]): PolylineEdge[] {
  const out: PolylineEdge[] = []
  for (let i = 0; i + 3 < points.length; i += 2) {
    const x1 = points[i], y1 = points[i + 1], x2 = points[i + 2], y2 = points[i + 3]
    out.push({ x1, y1, x2, y2, px: Math.hypot(x2 - x1, y2 - y1), midX: (x1 + x2) / 2, midY: (y1 + y2) / 2 })
  }
  return out
}

/** Metres for each edge, at centimetre precision, in path order. */
export function edgeLengthsM(points: readonly number[], pixelsPerMeter: number): number[] {
  if (!(pixelsPerMeter > 0)) {
    throw new Error('Cannot measure without a positive calibration (pixels per metre).')
  }
  return polylineEdges(points).map((e) => roundMetres(e.px / pixelsPerMeter))
}

// ─────────────────────────────────────────────────────────────────────────────
// EDITING A SAVED LEG — pure, index-checked, never in place.
// ─────────────────────────────────────────────────────────────────────────────
// The canvas drags a vertex and asks for a new point list; it never mutates the
// stored array, so an aborted edit leaves the saved leg exactly as it was.

function assertVertexIndex(points: readonly number[], index: number): void {
  const count = points.length / 2
  if (!Number.isInteger(index) || index < 0 || index >= count) {
    throw new Error(`Vertex index ${index} is out of range for a leg with ${count} vertices.`)
  }
}

/** The leg with vertex `index` moved to (x, y). */
export function moveVertex(points: readonly number[], index: number, x: number, y: number): number[] {
  assertVertexIndex(points, index)
  const out = [...points]
  out[index * 2] = x
  out[index * 2 + 1] = y
  return out
}

/** The leg with a new vertex (x, y) inserted after vertex `index`. */
export function insertVertexAfter(points: readonly number[], index: number, x: number, y: number): number[] {
  assertVertexIndex(points, index)
  const at = (index + 1) * 2
  return [...points.slice(0, at), x, y, ...points.slice(at)]
}

/**
 * The leg without vertex `index`. Refuses to go below two vertices: a single
 * point is not a route, and the server would reject it anyway — better to say
 * so here than to lose the leg on save.
 */
export function removeVertex(points: readonly number[], index: number): number[] {
  assertVertexIndex(points, index)
  if (points.length <= 4) {
    throw new Error('A leg needs at least two vertices; delete the leg instead.')
  }
  const at = index * 2
  return [...points.slice(0, at), ...points.slice(at + 2)]
}

/**
 * Collapse consecutive vertices closer than `tolerancePx` into one.
 *
 * A double-click finishes a polyline, but each of its two mousedowns has
 * already appended a vertex on top of the last real one by the time the
 * dblclick fires. Left in, a leg carries two zero-length edges and prints
 * "0.00 m" twice — invisible on a markup polyline, wrong on a measurement.
 */
export function dedupeConsecutivePoints(points: readonly number[], tolerancePx: number): number[] {
  if (points.length < 2) return [...points]
  const out: number[] = [points[0], points[1]]
  for (let i = 2; i + 1 < points.length; i += 2) {
    const lx = out[out.length - 2], ly = out[out.length - 1]
    if (Math.hypot(points[i] - lx, points[i + 1] - ly) > tolerancePx) out.push(points[i], points[i + 1])
  }
  return out
}

// ─────────────────────────────────────────────────────────────────────────────
// THE SHEET LEGEND — what an exported drawing says about the runs drawn on it.
// ─────────────────────────────────────────────────────────────────────────────
// Rendered from the route tables at export time, never stored in a scene, so
// it cannot drift from the schedule. `onSheetM` is the metres drawn on THIS
// page; `totalM` is the whole run; `continuesElsewhere` is the honest half —
// a reader must never take the number beside a line for the length of what is
// drawn in front of them when part of the route is on another sheet.

export interface LegendRun {
  supplyId: string
  /** "MB 1.1 → DB-10" */
  label: string
  totalM: number
}

export interface LegendSegment {
  supplyId: string
  floorPlanId: string | null
  pageIndex: number
  lengthM: number
}

export interface SheetLegendRow {
  label: string
  legsHere: number
  onSheetM: number
  totalM: number
  continuesElsewhere: boolean
}

export function sheetLegendRows(
  sheet: { floorPlanId: string; pageIndex: number },
  runs: readonly LegendRun[],
  segments: readonly LegendSegment[],
): SheetLegendRow[] {
  const runById = new Map(runs.map((r) => [r.supplyId, r]))
  const here = new Map<string, { legs: number; m: number }>()
  const everywhere = new Map<string, number>()
  for (const s of segments) {
    if (!runById.has(s.supplyId)) continue
    everywhere.set(s.supplyId, (everywhere.get(s.supplyId) ?? 0) + 1)
    if (s.floorPlanId === sheet.floorPlanId && s.pageIndex === sheet.pageIndex) {
      const cur = here.get(s.supplyId) ?? { legs: 0, m: 0 }
      cur.legs += 1
      cur.m += s.lengthM
      here.set(s.supplyId, cur)
    }
  }
  return [...here.entries()]
    .map(([supplyId, h]) => {
      const run = runById.get(supplyId)!
      return {
        label: run.label,
        legsHere: h.legs,
        onSheetM: roundMetres(h.m),
        totalM: roundMetres(run.totalM),
        continuesElsewhere: (everywhere.get(supplyId) ?? 0) > h.legs,
      }
    })
    .sort((a, b) => a.label.localeCompare(b.label))
}
