import { describe, it, expect } from 'vitest'
import { segmentToImageSpace } from './line-space'
import type { Matrix } from './text-space'

// pdf.js viewports for a 600×400 pt page at scale 2 (see text-space.test.ts).
const UPRIGHT: Matrix = [2, 0, 0, -2, 0, 800]
const ROTATE_90: Matrix = [0, 2, 2, 0, 0, 0]

describe('segmentToImageSpace', () => {
  it('maps a horizontal user-space line on an unrotated page to a horizontal image line (y flips)', () => {
    const v = UPRIGHT
    // user y = 300 → raster y = (400 − 300)·2 = 200
    expect(segmentToImageSpace(50, 300, 150, 300, v)).toEqual({ axis: 'h', at: 200, from: 100, to: 300 })
  })

  it('/Rotate 90: a user-space horizontal line becomes a vertical image line', () => {
    const v = ROTATE_90
    // raster x = 2·userY, raster y = 2·userX
    expect(segmentToImageSpace(150, 60, 50, 60, v)).toEqual({ axis: 'v', at: 120, from: 100, to: 300 })
  })

  it('orders from < to whatever direction the path was drawn in', () => {
    const v = UPRIGHT
    expect(segmentToImageSpace(10, 100, 10, 50, v)).toEqual({ axis: 'v', at: 20, from: 600, to: 700 })
  })

  it('drops a diagonal line', () => {
    const v = UPRIGHT
    expect(segmentToImageSpace(0, 0, 100, 40, v)).toBeNull()
  })

  it('keeps a line within a hair of axis-aligned (CAD round-off) at its mean position', () => {
    const v: Matrix = [1, 0, 0, 1, 0, 0]
    const s = segmentToImageSpace(0, 10, 200, 10.2, v)
    expect(s).toMatchObject({ axis: 'h', from: 0, to: 200 })
    expect(s!.at).toBeCloseTo(10.1, 9)
  })

  it('drops a point and anything not finite', () => {
    const v: Matrix = [1, 0, 0, 1, 0, 0]
    expect(segmentToImageSpace(5, 5, 5, 5, v)).toBeNull()
    expect(segmentToImageSpace(Number.NaN, 5, 9, 5, v)).toBeNull()
  })
})
