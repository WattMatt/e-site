import { describe, it, expect } from 'vitest'
import {
  flatToPts, ptsToFlat, pxToM, mToPx, distance, polygonArea, vertexMean, pointInPolygon,
  pointSegmentDistance, segmentsCross, segmentDistance, onBoundary, quadInsideRoof,
  quadClearOfPolygon, quadClearOfCircle, rotateAbout, isSimplePolygon, rectQuad,
} from './geometry'
import type { Pt } from './types'

const rect = (x0: number, y0: number, x1: number, y1: number): Pt[] => [
  { x: x0, y: y0 }, { x: x1, y: y0 }, { x: x1, y: y1 }, { x: x0, y: y1 },
]
const L_ROOF: Pt[] = [
  { x: 0, y: 0 }, { x: 16, y: 0 }, { x: 16, y: 6 }, { x: 8, y: 6 }, { x: 8, y: 12 }, { x: 0, y: 12 },
]

describe('point lists', () => {
  it('round-trips flat ↔ points and refuses an odd count', () => {
    expect(flatToPts([1, 2, 3, 4])).toEqual([{ x: 1, y: 2 }, { x: 3, y: 4 }])
    expect(ptsToFlat([{ x: 1, y: 2 }, { x: 3, y: 4 }])).toEqual([1, 2, 3, 4])
    expect(() => flatToPts([1, 2, 3])).toThrow('even number')
  })
  it('converts pixels to metres and back with the object’s own scale', () => {
    expect(pxToM([100, 50], 50)).toEqual([{ x: 2, y: 1 }])
    expect(mToPx([{ x: 2, y: 1 }], 50)).toEqual([100, 50])
    expect(() => pxToM([1, 1], 0)).toThrow('positive')
  })
})

describe('measures', () => {
  it('distance and shoelace area (orientation-independent)', () => {
    expect(distance({ x: 0, y: 0 }, { x: 3, y: 4 })).toBe(5)
    expect(polygonArea(rect(0, 0, 20, 12))).toBe(240)
    expect(polygonArea([...rect(0, 0, 20, 12)].reverse())).toBe(240)
    expect(polygonArea(L_ROOF)).toBe(144)
  })
  it('vertexMean is the average vertex', () => {
    expect(vertexMean(rect(0, 0, 2, 4))).toEqual({ x: 1, y: 2 })
  })
})

describe('pointInPolygon', () => {
  it('handles a concave (L-shaped) roof', () => {
    expect(pointInPolygon({ x: 4, y: 9 }, L_ROOF)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 3 }, L_ROOF)).toBe(true)
    expect(pointInPolygon({ x: 12, y: 9 }, L_ROOF)).toBe(false)
  })
})

describe('segments', () => {
  it('point to segment distance clamps to the ends', () => {
    expect(pointSegmentDistance({ x: 0, y: 1 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(1)
    expect(pointSegmentDistance({ x: 3, y: 0 }, { x: -1, y: 0 }, { x: 1, y: 0 })).toBe(2)
  })
  it('only a PROPER crossing counts as crossing (touching and collinear do not)', () => {
    expect(segmentsCross({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })).toBe(true)
    expect(segmentsCross({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 0 }, { x: 0, y: 1 })).toBe(false)
    expect(segmentsCross({ x: 0, y: 0 }, { x: 2, y: 0 }, { x: 1, y: 0 }, { x: 3, y: 0 })).toBe(false)
  })
  it('segment distance is 0 when crossing, else the nearest endpoint projection', () => {
    expect(segmentDistance({ x: -1, y: 0 }, { x: 1, y: 0 }, { x: 0, y: -1 }, { x: 0, y: 1 })).toBe(0)
    expect(segmentDistance({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 0, y: 1 }, { x: 4, y: 1 })).toBe(1)
  })
  it('onBoundary detects a point on an edge', () => {
    expect(onBoundary({ x: 5, y: 0 }, rect(0, 0, 10, 10))).toBe(true)
    expect(onBoundary({ x: 5, y: 5 }, rect(0, 0, 10, 10))).toBe(false)
  })
})

describe('quad against roof and obstructions', () => {
  const roof = rect(0, 0, 20, 12)
  it('inside with clearance', () => {
    expect(quadInsideRoof(rect(1, 1, 3, 3), roof, 0.5)).toBe(true)
    expect(quadInsideRoof(rect(1, 1, 3, 3), roof, 1.5)).toBe(false) // only 1 m from the edge
    expect(quadInsideRoof(rect(0.5, 0.5, 2, 2), roof, 0.5)).toBe(true) // exactly the setback
  })
  it('refuses the notch of an L roof and a quad straddling the inner corner', () => {
    expect(quadInsideRoof(rect(10, 8, 12, 10), L_ROOF, 0.5)).toBe(false)
    expect(quadInsideRoof(rect(7, 5, 9, 7), L_ROOF, 0)).toBe(false)
  })
  it('keeps the obstruction setback, and refuses a quad that swallows the obstruction', () => {
    const plant = rect(3, 2, 5, 4)
    expect(quadClearOfPolygon(rect(5.5, 2, 7, 4), plant, 0.6)).toBe(false) // 0.5 m away
    expect(quadClearOfPolygon(rect(5.7, 2, 7, 4), plant, 0.6)).toBe(true)
    expect(quadClearOfPolygon(rect(2, 1, 6, 5), plant, 0.6)).toBe(false)
  })
  it('keeps the radius plus setback clear of a circular obstruction', () => {
    const c = { x: 4, y: 9 }
    expect(quadClearOfCircle(rect(4.7, 8, 6, 10), c, 0.5, 0.3)).toBe(false) // 0.7 < 0.8
    expect(quadClearOfCircle(rect(4.8, 8, 6, 10), c, 0.5, 0.3)).toBe(true)
    expect(quadClearOfCircle(rect(3, 8, 5, 10), c, 0.5, 0.3)).toBe(false) // centre inside
  })
})

describe('rotation and simplicity', () => {
  it('rotates clockwise ON SCREEN (image y points down)', () => {
    const p = rotateAbout({ x: 1, y: 0 }, { x: 0, y: 0 }, 90)
    expect(p.x).toBeCloseTo(0, 12)
    expect(p.y).toBeCloseTo(1, 12)
  })
  it('refuses a bow-tie and accepts the L roof', () => {
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 2, y: 2 }, { x: 2, y: 0 }, { x: 0, y: 2 }])).toBe(false)
    expect(isSimplePolygon(L_ROOF)).toBe(true)
    expect(isSimplePolygon([{ x: 0, y: 0 }, { x: 1, y: 0 }])).toBe(false)
  })
  it('rectQuad builds a quad from a corner and two axis vectors', () => {
    expect(rectQuad({ x: 1, y: 1 }, { x: 1, y: 0 }, { x: 0, y: 1 }, 2, 3)).toEqual(rect(1, 1, 3, 4))
  })
})
