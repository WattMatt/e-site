import { describe, it, expect } from 'vitest'
import {
  polylineLengthPx,
  segmentLengthM,
  derivePixelsPerMeter,
  routeTotalM,
  validateRoutePoints,
  isSegmentCalibrationStale,
  roundMetres,
  polylineEdges,
  edgeLengthsM,
  moveVertex,
  insertVertexAfter,
  removeVertex,
  type RouteSegmentForTotal,
} from './cable-route.service'

/**
 * Pure measurement maths for tracing a cable run on a calibrated drawing.
 *
 * ⚠ FIXTURE NOTE, and it is the reason these tests can fail at all.
 *
 * Every polyline fixture below has a BEND, and its legs have DIFFERENT lengths.
 * A straight-line fixture would be worthless here: the single most likely bug in
 * a polyline measurer is summing the distance from the first point to the last
 * instead of walking the path, and on a straight line those two answers are
 * identical. The L-shape 300→400 is 700px along the path and 500px end to end,
 * so the two implementations cannot both pass.
 *
 * The same logic drives the totals fixture: the segment lengths, the rise and
 * the drop are all different numbers, so dropping any one term gives a DISTINCT
 * wrong total rather than one that might coincide with another mistake.
 */

describe('polylineLengthPx', () => {
  it('walks the path rather than measuring end to end', () => {
    // (0,0) → (300,0) → (300,400).  Along the path: 300 + 400 = 700.
    // End to end it is hypot(300,400) = 500. Only one of those is right.
    expect(polylineLengthPx([0, 0, 300, 0, 300, 400])).toBe(700)
  })

  it('measures a diagonal leg exactly, not just axis-aligned ones', () => {
    // 3-4-5: (0,0) → (30,40) is 50, then (30,40) → (30,50) is 10.
    expect(polylineLengthPx([0, 0, 30, 40, 30, 50])).toBe(60)
  })

  it('sums every leg of a many-point route', () => {
    // Four legs of 10 each, zig-zagging so no two are collinear.
    const pts = [0, 0, 10, 0, 10, 10, 20, 10, 20, 20]
    expect(polylineLengthPx(pts)).toBe(40)
  })

  it('is zero for a two-point line of zero length', () => {
    expect(polylineLengthPx([5, 5, 5, 5])).toBe(0)
  })
})

describe('validateRoutePoints', () => {
  it('rejects a point array with an odd number of values', () => {
    expect(validateRoutePoints([0, 0, 10])).toMatch(/pairs/i)
  })

  it('rejects fewer than two points — a route needs a direction', () => {
    expect(validateRoutePoints([0, 0])).toMatch(/at least two/i)
  })

  it('rejects non-finite coordinates', () => {
    expect(validateRoutePoints([0, 0, Number.NaN, 10])).toMatch(/finite/i)
    expect(validateRoutePoints([0, 0, Infinity, 10])).toMatch(/finite/i)
  })

  it('accepts a valid polyline', () => {
    expect(validateRoutePoints([0, 0, 300, 0, 300, 400])).toBeNull()
  })
})

describe('derivePixelsPerMeter', () => {
  it('derives calibration from a known distance', () => {
    // 250px drawn across something the user says is 5m → 50 px/m.
    expect(derivePixelsPerMeter([0, 0, 250, 0], 5)).toBe(50)
  })

  it('uses the true diagonal distance, not the bounding box', () => {
    // hypot(30,40) = 50px over 2m → 25 px/m. A dx-only bug gives 15.
    expect(derivePixelsPerMeter([0, 0, 30, 40], 2)).toBe(25)
  })

  it('refuses a zero or negative real-world distance', () => {
    expect(() => derivePixelsPerMeter([0, 0, 250, 0], 0)).toThrow(/greater than zero/i)
    expect(() => derivePixelsPerMeter([0, 0, 250, 0], -5)).toThrow(/greater than zero/i)
  })

  it('refuses two identical points — that calibrates nothing', () => {
    expect(() => derivePixelsPerMeter([10, 10, 10, 10], 5)).toThrow(/two distinct/i)
  })
})

describe('segmentLengthM', () => {
  it('converts traced pixels to metres using the supplied calibration', () => {
    // The L-shape above, 700px, at 100 px/m.
    expect(segmentLengthM([0, 0, 300, 0, 300, 400], 100)).toBe(7)
  })

  it('rounds to two decimal places', () => {
    // 700px at 33 px/m = 21.2121… m
    expect(segmentLengthM([0, 0, 300, 0, 300, 400], 33)).toBe(21.21)
  })

  it('refuses a non-positive calibration instead of returning Infinity', () => {
    expect(() => segmentLengthM([0, 0, 10, 0], 0)).toThrow(/calibration/i)
    expect(() => segmentLengthM([0, 0, 10, 0], -1)).toThrow(/calibration/i)
  })
})

describe('routeTotalM', () => {
  /**
   * Two segments on different sheets, plus a rise at one end and a drop at the
   * other. Every term is a different number on purpose — see the fixture note.
   *   segments 7.00 + 3.25 = 10.25
   *   + rise 3.50           = 13.75
   *   + drop 0.75           = 14.50
   * Omitting the rise gives 11.00, the drop 13.75, the second segment 11.25.
   * No two mistakes land on the same answer.
   */
  const segments: RouteSegmentForTotal[] = [
    { length_m: 7 },
    { length_m: 3.25 },
  ]

  it('sums every segment and both vertical allowances', () => {
    expect(routeTotalM({ segments, riseM: 3.5, dropM: 0.75 })).toBe(14.5)
  })

  it('counts the second segment — a cross-sheet run is not just its first sheet', () => {
    const oneSheet = routeTotalM({ segments: [segments[0]], riseM: 3.5, dropM: 0.75 })
    expect(oneSheet).toBe(11.25)
    expect(routeTotalM({ segments, riseM: 3.5, dropM: 0.75 })).not.toBe(oneSheet)
  })

  it('treats missing allowances as zero, not as a reason to fail', () => {
    expect(routeTotalM({ segments, riseM: 0, dropM: 0 })).toBe(10.25)
  })

  it('is zero for a route with no segments and no allowances', () => {
    expect(routeTotalM({ segments: [], riseM: 0, dropM: 0 })).toBe(0)
  })

  it('still totals the allowances when nothing has been traced yet', () => {
    // A run whose horizontal route is not drawn yet but whose drops are known.
    expect(routeTotalM({ segments: [], riseM: 3.5, dropM: 0.75 })).toBe(4.25)
  })

  it('rejects negative allowances rather than silently shortening a run', () => {
    expect(() => routeTotalM({ segments, riseM: -1, dropM: 0 })).toThrow(/negative/i)
    expect(() => routeTotalM({ segments, riseM: 0, dropM: -1 })).toThrow(/negative/i)
  })
})

describe('isSegmentCalibrationStale', () => {
  /**
   * The defect this exists to prevent: the shipped MeasureShape stores only
   * pixels and recomputes metres from the drawing's CURRENT calibration, so
   * recalibrating a drawing silently rewrites every measurement taken on it.
   * A cable length gets signed off. It must not move underneath the signature.
   */
  it('flags a segment whose drawing has been recalibrated since it was traced', () => {
    expect(isSegmentCalibrationStale({ pixels_per_meter: 50 }, 55)).toBe(true)
  })

  it('does not flag a segment whose drawing calibration is unchanged', () => {
    expect(isSegmentCalibrationStale({ pixels_per_meter: 50 }, 50)).toBe(false)
  })

  it('tolerates floating-point noise rather than crying wolf', () => {
    expect(isSegmentCalibrationStale({ pixels_per_meter: 50 }, 50 + 1e-9)).toBe(false)
  })

  it('does not flag when the drawing has no calibration to compare against', () => {
    // Calibration cleared on the plan. The stored measurement is still the
    // best evidence there is; nothing has contradicted it.
    expect(isSegmentCalibrationStale({ pixels_per_meter: 50 }, null)).toBe(false)
  })
})

describe('roundMetres', () => {
  it('rounds to two decimal places', () => {
    expect(roundMetres(21.21212)).toBe(21.21)
    expect(roundMetres(21.215)).toBe(21.22)
  })

  it('does not introduce binary floating-point dust', () => {
    // 0.1 + 0.2 is the classic. A naive sum would give 0.30000000000000004.
    expect(roundMetres(0.1 + 0.2)).toBe(0.3)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Per-edge geometry — what the canvas labels while you trace and after you save.
// ─────────────────────────────────────────────────────────────────────────────

describe('polylineEdges', () => {
  it('returns one edge per vertex pair, each with its own pixel length and midpoint', () => {
    // L-shape (0,0)→(300,0)→(300,400): two edges of DIFFERENT length, so a
    // function that labelled every edge with the same number could not pass.
    const edges = polylineEdges([0, 0, 300, 0, 300, 400])
    expect(edges).toHaveLength(2)
    expect(edges[0]).toEqual({ x1: 0, y1: 0, x2: 300, y2: 0, px: 300, midX: 150, midY: 0 })
    expect(edges[1]).toEqual({ x1: 300, y1: 0, x2: 300, y2: 400, px: 400, midX: 300, midY: 200 })
  })

  it('is empty for a single point — nothing to label yet', () => {
    expect(polylineEdges([10, 10])).toEqual([])
  })

  it('is empty for no points', () => {
    expect(polylineEdges([])).toEqual([])
  })
})

describe('edgeLengthsM', () => {
  it('labels each edge in metres at centimetre precision', () => {
    // 50 px/m: 300px = 6.00m, 400px = 8.00m. Distinct on purpose.
    expect(edgeLengthsM([0, 0, 300, 0, 300, 400], 50)).toEqual([6, 8])
  })

  it('labels a diagonal edge by its true length, not its bounding box', () => {
    // (0,0)→(30,40) is 50px → 1.00m at 50px/m; a dx-only bug would say 0.60.
    expect(edgeLengthsM([0, 0, 30, 40], 50)).toEqual([1])
  })

  it('agrees with the stored segment length to within rounding of each label', () => {
    // The labels are per-edge rounded; the stored length rounds the whole path
    // once. They can legitimately differ by up to half a cent per edge — and no
    // more. A different formula in either place would blow past that bound.
    const pts = [0, 0, 123, 45, 210, 300, 333, 333, 400, 12]
    const labels = edgeLengthsM(pts, 37)
    const sum = labels.reduce((a, b) => a + b, 0)
    expect(Math.abs(sum - segmentLengthM(pts, 37))).toBeLessThanOrEqual(0.005 * labels.length)
  })

  it('refuses a non-positive calibration, like segmentLengthM does', () => {
    expect(() => edgeLengthsM([0, 0, 10, 0], 0)).toThrow(/calibration/i)
  })
})

// ─────────────────────────────────────────────────────────────────────────────
// Editing a saved leg — drag a vertex, add one, drop one. Pure, so the canvas
// cannot corrupt a stored route by getting an index off by one.
// ─────────────────────────────────────────────────────────────────────────────

describe('moveVertex', () => {
  const pts = [0, 0, 300, 0, 300, 400]

  it('moves exactly the named vertex and leaves the others alone', () => {
    expect(moveVertex(pts, 1, 310, 5)).toEqual([0, 0, 310, 5, 300, 400])
  })

  it('does not mutate the input', () => {
    const copy = [...pts]
    moveVertex(pts, 0, 99, 99)
    expect(pts).toEqual(copy)
  })

  it('rejects an out-of-range vertex index', () => {
    expect(() => moveVertex(pts, 3, 0, 0)).toThrow(/index/i)
    expect(() => moveVertex(pts, -1, 0, 0)).toThrow(/index/i)
  })
})

describe('insertVertexAfter', () => {
  const pts = [0, 0, 300, 0, 300, 400]

  it('inserts between the named vertex and the next one', () => {
    expect(insertVertexAfter(pts, 0, 150, 10)).toEqual([0, 0, 150, 10, 300, 0, 300, 400])
  })

  it('appends when the named vertex is the last one', () => {
    expect(insertVertexAfter(pts, 2, 500, 400)).toEqual([0, 0, 300, 0, 300, 400, 500, 400])
  })

  it('rejects an out-of-range vertex index', () => {
    expect(() => insertVertexAfter(pts, 3, 0, 0)).toThrow(/index/i)
  })
})

describe('removeVertex', () => {
  const pts = [0, 0, 300, 0, 300, 400]

  it('removes exactly the named vertex', () => {
    expect(removeVertex(pts, 1)).toEqual([0, 0, 300, 400])
  })

  it('refuses to reduce a leg below two vertices — a route needs a direction', () => {
    expect(() => removeVertex([0, 0, 10, 10], 0)).toThrow(/two/i)
  })

  it('rejects an out-of-range vertex index', () => {
    expect(() => removeVertex(pts, 3)).toThrow(/index/i)
  })
})
