import { describe, it, expect } from 'vitest'
import {
  dashFor,
  snapAngle,
  gridSpacingPx,
  snapToGrid,
  gridLineOffsets,
  pointSegmentDistance,
  distToPolyline,
  pointInPolygon,
  rectContains,
  ellipseContains,
  scalePointsAbout,
  rotatePointsAbout,
  translatePoints,
  bakePointTransform,
  contrastText,
  tableAddRow,
  tableAddCol,
  tableRemoveRow,
  tableRemoveCol,
  tableSetCell,
} from './markup-geometry'

describe('dashFor', () => {
  it('returns undefined for solid (no dash)', () => {
    expect(dashFor('solid', 2)).toBeUndefined()
    expect(dashFor('solid', 8)).toBeUndefined()
  })

  it('returns a two-entry dash array for dashed/dotted', () => {
    expect(dashFor('dashed', 4)).toHaveLength(2)
    expect(dashFor('dotted', 4)).toHaveLength(2)
  })

  it('scales the pattern with stroke width (thicker → longer gaps)', () => {
    const thin = dashFor('dashed', 2)!
    const thick = dashFor('dashed', 8)!
    expect(thick[0]).toBeGreaterThan(thin[0])
    expect(thick[1]).toBeGreaterThan(thin[1])
  })

  it('keeps dotted dots short relative to gaps (reads as dots, not dashes)', () => {
    const [dot, gap] = dashFor('dotted', 8)!
    expect(dot).toBeLessThan(gap)
  })
})

describe('snapAngle', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 4)

  it('snaps a near-horizontal drag to 0° and preserves distance', () => {
    const [x, y] = snapAngle(0, 0, 100, 5)
    near(y, 0)
    near(x, Math.hypot(100, 5))
  })

  it('snaps a near-vertical drag to 90°', () => {
    const [x, y] = snapAngle(0, 0, 5, 100)
    near(x, 0)
    near(y, Math.hypot(5, 100))
  })

  it('snaps a ~45° drag to a true diagonal (equal legs)', () => {
    const [x, y] = snapAngle(0, 0, 100, 90)
    near(x, y)
    // distance preserved
    near(Math.hypot(x, y), Math.hypot(100, 90))
  })

  it('snaps backwards drags to 180°', () => {
    const [x, y] = snapAngle(0, 0, -100, 3)
    near(y, 0)
    near(x, -Math.hypot(100, 3))
  })

  it('is a no-op at zero distance', () => {
    expect(snapAngle(10, 10, 10, 10)).toEqual([10, 10])
  })

  it('snaps around a non-origin anchor', () => {
    const [x, y] = snapAngle(50, 50, 150, 47)
    near(y, 50)
    near(x, 50 + Math.hypot(100, 3))
  })
})

describe('gridSpacingPx', () => {
  it('uses calibration when available (1 m grid at 200 px/m → 200 px)', () => {
    expect(gridSpacingPx(1, 200)).toBe(200)
    expect(gridSpacingPx(0.5, 200)).toBe(100)
    expect(gridSpacingPx(5, 200)).toBe(1000)
  })

  it('falls back to a pixel grid when uncalibrated', () => {
    expect(gridSpacingPx(1, null)).toBe(50)
    expect(gridSpacingPx(1, null, 25)).toBe(25)
    expect(gridSpacingPx(1, 0)).toBe(50)
  })
})

describe('snapToGrid', () => {
  it('rounds to the nearest grid line', () => {
    expect(snapToGrid(0, 50)).toBe(0)
    expect(snapToGrid(24, 50)).toBe(0)
    expect(snapToGrid(26, 50)).toBe(50)
    expect(snapToGrid(240, 50)).toBe(250)
    expect(snapToGrid(-26, 50)).toBe(-50)
  })

  it('is a no-op for a non-positive spacing', () => {
    expect(snapToGrid(37, 0)).toBe(37)
    expect(snapToGrid(37, -5)).toBe(37)
  })
})

describe('gridLineOffsets', () => {
  it('emits inclusive offsets across the extent', () => {
    expect(gridLineOffsets(200, 50)).toEqual([0, 50, 100, 150, 200])
  })

  it('caps runaway line counts (returns [] past the cap)', () => {
    expect(gridLineOffsets(100000, 1, 400)).toEqual([])
  })

  it('returns [] for degenerate inputs', () => {
    expect(gridLineOffsets(0, 50)).toEqual([])
    expect(gridLineOffsets(200, 0)).toEqual([])
  })
})

describe('pointSegmentDistance', () => {
  it('is 0 on the segment', () => {
    expect(pointSegmentDistance(5, 0, 0, 0, 10, 0)).toBe(0)
  })
  it('is the perpendicular distance beside the segment', () => {
    expect(pointSegmentDistance(5, 4, 0, 0, 10, 0)).toBeCloseTo(4, 6)
  })
  it('clamps past the endpoints', () => {
    expect(pointSegmentDistance(-3, 0, 0, 0, 10, 0)).toBeCloseTo(3, 6)
    expect(pointSegmentDistance(13, 0, 0, 0, 10, 0)).toBeCloseTo(3, 6)
  })
  it('handles a degenerate (zero-length) segment', () => {
    expect(pointSegmentDistance(3, 4, 0, 0, 0, 0)).toBeCloseTo(5, 6)
  })
})

describe('distToPolyline', () => {
  const L = [0, 0, 10, 0, 10, 10] // open L-shape
  it('finds the nearest segment', () => {
    expect(distToPolyline(5, 3, L)).toBeCloseTo(3, 6) // near the horizontal leg
    expect(distToPolyline(13, 5, L)).toBeCloseTo(3, 6) // near the vertical leg
  })
  it('includes the closing segment only when closed', () => {
    // point near the (last→first) closing edge of a triangle
    const tri = [0, 0, 10, 0, 5, 10]
    const open = distToPolyline(2.5, 5, tri, false)
    const closed = distToPolyline(2.5, 5, tri, true)
    expect(closed).toBeLessThan(open)
  })
})

describe('pointInPolygon', () => {
  const sq = [0, 0, 10, 0, 10, 10, 0, 10]
  it('detects inside vs outside', () => {
    expect(pointInPolygon(5, 5, sq)).toBe(true)
    expect(pointInPolygon(15, 5, sq)).toBe(false)
    expect(pointInPolygon(-1, 5, sq)).toBe(false)
  })
})

describe('rectContains', () => {
  it('respects bounds and pad, and normalises negative w/h', () => {
    expect(rectContains(5, 5, 0, 0, 10, 10)).toBe(true)
    expect(rectContains(11, 5, 0, 0, 10, 10)).toBe(false)
    expect(rectContains(11, 5, 0, 0, 10, 10, 2)).toBe(true) // within pad
    expect(rectContains(-5, -5, 0, 0, -10, -10)).toBe(true) // negative w/h
  })
})

describe('ellipseContains', () => {
  it('detects inside/outside with pad', () => {
    expect(ellipseContains(0, 0, 0, 0, 10, 5)).toBe(true)
    expect(ellipseContains(10, 0, 0, 0, 10, 5)).toBe(true) // on the x-radius
    expect(ellipseContains(11, 0, 0, 0, 10, 5)).toBe(false)
    expect(ellipseContains(11, 0, 0, 0, 10, 5, 2)).toBe(true) // pad
  })
})

describe('scale/rotate/translate points', () => {
  it('scales about an anchor', () => {
    expect(scalePointsAbout([2, 2, 4, 4], 2, 2, 0, 0)).toEqual([4, 4, 8, 8])
    expect(scalePointsAbout([2, 2], 2, 2, 2, 2)).toEqual([2, 2]) // anchor fixed
  })
  it('rotates 90° about the origin', () => {
    const [x, y] = rotatePointsAbout([10, 0], Math.PI / 2, 0, 0)
    expect(x).toBeCloseTo(0, 6)
    expect(y).toBeCloseTo(10, 6)
  })
  it('translates', () => {
    expect(translatePoints([1, 2, 3, 4], 10, -5)).toEqual([11, -3, 13, -1])
  })
})

describe('bakePointTransform (scale → rotate → translate, matches Konva T∘R∘S)', () => {
  const near = (a: number, b: number) => expect(a).toBeCloseTo(b, 6)
  it('is identity for unit scale, no rotation, no translation', () => {
    expect(bakePointTransform([3, 4], 1, 1, 0, 0, 0)).toEqual([3, 4])
  })
  it('applies scale, then rotation, then translation in order', () => {
    // [10,0] → scale×2 → [20,0] → rotate 90° → [0,20] → translate (5,5) → [5,25]
    const [x, y] = bakePointTransform([10, 0], 2, 2, 90, 5, 5)
    near(x, 5)
    near(y, 25)
  })
  it('handles pure translation and pure scale', () => {
    expect(bakePointTransform([1, 2, 3, 4], 1, 1, 0, 10, 20)).toEqual([11, 22, 13, 24])
    const [x, y] = bakePointTransform([2, 3], 3, 2, 0, 0, 0)
    near(x, 6)
    near(y, 6)
  })
})

describe('table operations', () => {
  const base = [
    ['Item', 'Description'],
    ['A', 'first'],
  ]
  it('adds a row matching the column count', () => {
    const r = tableAddRow(base)
    expect(r).toHaveLength(3)
    expect(r[2]).toEqual(['', ''])
  })
  it('adds a column to every row', () => {
    const r = tableAddCol(base)
    expect(r[0]).toEqual(['Item', 'Description', ''])
    expect(r[1]).toEqual(['A', 'first', ''])
  })
  it('removes a row but keeps at least the header', () => {
    expect(tableRemoveRow(base)).toEqual([['Item', 'Description']])
    expect(tableRemoveRow([['only']])).toEqual([['only']])
  })
  it('removes a column but keeps at least one', () => {
    expect(tableRemoveCol(base)).toEqual([['Item'], ['A']])
    expect(tableRemoveCol([['only'], ['x']])).toEqual([['only'], ['x']])
  })
  it('sets a single cell immutably', () => {
    const r = tableSetCell(base, 1, 0, 'changed')
    expect(r[1][0]).toBe('changed')
    expect(base[1][0]).toBe('A') // original untouched
  })
})

describe('contrastText', () => {
  it('picks dark text on light notes, light on dark', () => {
    expect(contrastText('#fef08a')).toBe('#111827') // sticky yellow → dark
    expect(contrastText('#ffffff')).toBe('#111827')
    expect(contrastText('#000000')).toBe('#ffffff')
    expect(contrastText('#2563eb')).toBe('#ffffff') // blue → light
    expect(contrastText('nonsense')).toBe('#111827') // safe default
  })
})
