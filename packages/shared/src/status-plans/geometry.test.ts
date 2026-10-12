import { describe, it, expect } from 'vitest'
import {
  rectToPoints,
  boundingBox,
  shapeAreaPx,
  shapeAreaM2,
  pointInShape,
  distanceToEdge,
  visualCentre,
  hatchSegments,
  isSelfIntersecting,
} from './geometry'

/** A 12.5 m x 8 m L-shape with a 4.5 m x 3 m notch: 100 - 13.5 = 86.5 m². Invented. */
const L_METRES: Array<[number, number]> = [[0, 0], [12.5, 0], [12.5, 5], [8, 5], [8, 8], [0, 8]]
const PPM = 37.8
const L_PX = L_METRES.flatMap(([x, y]) => [x * PPM - 100.25, y * PPM - 40.5])

/** A "C": the vertex mean (55, 50) lies in the gap, outside the shape. */
const C_SHAPE = [0, 0, 100, 0, 100, 20, 20, 20, 20, 80, 100, 80, 100, 100, 0, 100]

/** A "U" opening downwards (y grows down the sheet): top bar 0..10, arms to 30. */
const U_SHAPE = [0, 0, 30, 0, 30, 30, 20, 30, 20, 10, 10, 10, 10, 30, 0, 30]

const PENTAGON = [0, 0, 100, 0, 130, 60, 50, 110, -20, 60]

describe('rectToPoints / boundingBox', () => {
  it('normalises any drag direction to TL, TR, BR, BL', () => {
    expect(rectToPoints(50, 40, 10, 5)).toEqual([10, 5, 50, 5, 50, 40, 10, 40])
  })
  it('boundingBox spans every vertex', () => {
    expect(boundingBox(PENTAGON)).toEqual({ minX: -20, minY: 0, maxX: 130, maxY: 110 })
  })
})

describe('area', () => {
  it('shoelace in pixels is orientation-independent', () => {
    const rect = rectToPoints(0, 0, 20, 12)
    const reversed = [0, 12, 20, 12, 20, 0, 0, 0] // the same rectangle, listed the other way round
    expect(shapeAreaPx(rect)).toBe(240)
    expect(shapeAreaPx(reversed)).toBe(240)
  })
  it('measures a fractional, negative-coordinate L-shape in m²', () => {
    expect(shapeAreaM2(L_PX, PPM)).toBeCloseTo(86.5, 9)
  })
  it('has no area without a usable scale', () => {
    expect(shapeAreaM2(L_PX, null)).toBeNull()
    expect(shapeAreaM2(L_PX, undefined)).toBeNull()
    expect(shapeAreaM2(L_PX, 0)).toBeNull()
    expect(shapeAreaM2(L_PX, -5)).toBeNull()
  })
})

describe('pointInShape / distanceToEdge', () => {
  it('knows inside from outside on a concave shape', () => {
    expect(pointInShape(10, 50, C_SHAPE)).toBe(true)
    expect(pointInShape(55, 50, C_SHAPE)).toBe(false)
  })
  it('distance is positive inside, negative outside, zero on an edge', () => {
    expect(distanceToEdge(10, 50, C_SHAPE)).toBeCloseTo(10, 9)
    expect(distanceToEdge(55, 50, C_SHAPE)).toBeCloseTo(-30, 9)
    expect(distanceToEdge(50, 0, C_SHAPE)).toBe(0)
  })
})

describe('visualCentre', () => {
  it('finds the widest point of a rectangle within the precision', () => {
    const rect = rectToPoints(0, 0, 100, 40)
    const c = visualCentre(rect, 1)
    expect(pointInShape(c.x, c.y, rect)).toBe(true)
    expect(distanceToEdge(c.x, c.y, rect)).toBeGreaterThanOrEqual(19)
  })
  it('lands inside a C-shape whose vertex mean is outside it', () => {
    const c = visualCentre(C_SHAPE, 1)
    expect(pointInShape(c.x, c.y, C_SHAPE)).toBe(true)
    expect(distanceToEdge(c.x, c.y, C_SHAPE)).toBeGreaterThanOrEqual(9)
  })
  it('lands inside the L-shape', () => {
    const c = visualCentre(L_PX, 1)
    expect(pointInShape(c.x, c.y, L_PX)).toBe(true)
  })
  it('returns the corner of a degenerate (zero-width) shape instead of looping', () => {
    expect(visualCentre([5, 5, 5, 10, 5, 20], 1)).toEqual({ x: 5, y: 5 })
  })
  it('refuses a non-positive precision', () => {
    expect(() => visualCentre(C_SHAPE, 0)).toThrow('precision must be positive')
  })
})

describe('hatchSegments', () => {
  it('fills a square with horizontal lines at half-spacing phase', () => {
    expect(hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 2 })).toEqual([
      [0, 1, 10, 1], [0, 3, 10, 3], [0, 5, 10, 5], [0, 7, 10, 7], [0, 9, 10, 9],
    ])
  })
  it('clips to a concave U: one segment across the bar, two across the arms', () => {
    expect(hatchSegments(U_SHAPE, { angleDeg: 0, spacing: 10 })).toEqual([
      [0, 5, 30, 5],
      [0, 15, 10, 15], [20, 15, 30, 15],
      [0, 25, 10, 25], [20, 25, 30, 25],
    ])
  })
  it.each([
    ['pentagon at 45°', PENTAGON, 45, 9],
    ['U at 30°', U_SHAPE, 30, 3],
    ['C at 135°', C_SHAPE, 135, 7],
  ])('%s: every segment starts and ends on the outline and runs inside it', (_l, pts, angleDeg, spacing) => {
    const segs = hatchSegments(pts, { angleDeg, spacing })
    expect(segs.length).toBeGreaterThan(3)
    for (const [x0, y0, x1, y1] of segs) {
      expect(Math.abs(distanceToEdge(x0, y0, pts))).toBeLessThan(1e-6)
      expect(Math.abs(distanceToEdge(x1, y1, pts))).toBeLessThan(1e-6)
      expect(pointInShape((x0 + x1) / 2, (y0 + y1) / 2, pts)).toBe(true)
    }
  })
  it('lines of two touching shapes share a phase (they continue across the seam)', () => {
    const left = hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 4 })
    const right = hatchSegments(rectToPoints(10, 0, 20, 10), { angleDeg: 0, spacing: 4 })
    expect(left.map((s) => s[1])).toEqual(right.map((s) => s[1]))
  })
  it('returns nothing for fewer than three corners and refuses a bad spacing', () => {
    expect(hatchSegments([0, 0, 10, 10], { angleDeg: 0, spacing: 2 })).toEqual([])
    expect(() => hatchSegments(rectToPoints(0, 0, 10, 10), { angleDeg: 0, spacing: 0 })).toThrow('spacing must be positive')
  })
})

describe('hatchSegments with vertices exactly on a scan line', () => {
  it('a diamond: the widest scan line passes through two vertices and is neither doubled nor lost', () => {
    const diamond = [5, 1, 9, 5, 5, 9, 1, 5]
    expect(hatchSegments(diamond, { angleDeg: 0, spacing: 2 })).toEqual([[3, 3, 7, 3], [1, 5, 9, 5], [3, 7, 7, 7]])
  })
  it('a W with reflex vertices on a scan line', () => {
    const w = [0, 0, 10, 0, 10, 10, 7, 5, 5, 10, 3, 5, 0, 10]
    expect(hatchSegments(w, { angleDeg: 0, spacing: 2 })).toEqual([
      [0, 1, 10, 1], [0, 3, 10, 3],
      // y = 5 runs through both reflex vertices: one line, split at them
      [0, 5, 3, 5], [3, 5, 7, 5], [7, 5, 10, 5],
      [0, 7, 1.8, 7], [3.8, 7, 6.2, 7], [8.2, 7, 10, 7],
      [0, 9, 0.6, 9], [4.6, 9, 5.4, 9], [9.4, 9, 10, 9],
    ])
  })
})

describe('isSelfIntersecting', () => {
  it('flags a bowtie', () => {
    expect(isSelfIntersecting([0, 0, 10, 10, 10, 0, 0, 10])).toBe(true)
  })
  it('does not flag a concave L, a square or a triangle', () => {
    expect(isSelfIntersecting([0, 0, 10, 0, 10, 5, 5, 5, 5, 10, 0, 10])).toBe(false)
    expect(isSelfIntersecting([0, 0, 10, 0, 10, 10, 0, 10])).toBe(false)
    expect(isSelfIntersecting([0, 0, 10, 0, 5, 8])).toBe(false)
  })
})

describe('visualCentre on degenerate slivers', () => {
  it.each([
    [10000, 1e-6],
    [100000, 1e-4],
  ])('a %d x %d rectangle returns inside its bbox quickly', (w, h) => {
    const t0 = performance.now()
    const c = visualCentre(rectToPoints(0, 0, w, h))
    // Unbounded, the 10000 x 1e-6 case allocated ~10^10 cells and crashed the
    // worker; bounded it is milliseconds. 2 s is a CI-safe ceiling, not a target.
    expect(performance.now() - t0).toBeLessThan(2000)
    expect(c.x).toBeGreaterThanOrEqual(0)
    expect(c.x).toBeLessThanOrEqual(w)
    expect(c.y).toBeGreaterThanOrEqual(0)
    expect(c.y).toBeLessThanOrEqual(h)
  })
})
