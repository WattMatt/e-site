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
