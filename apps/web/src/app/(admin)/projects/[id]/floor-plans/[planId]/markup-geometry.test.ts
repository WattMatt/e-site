import { describe, it, expect } from 'vitest'
import { dashFor, snapAngle, gridSpacingPx, snapToGrid, gridLineOffsets } from './markup-geometry'

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
