import { describe, it, expect } from 'vitest'
import { fitTransform, zoomAbout, MAX_SCALE } from './viewport-math'

describe('fitTransform', () => {
  it('centres a landscape sheet inside a portrait viewport at 95% of the limiting side', () => {
    const t = fitTransform({ w: 400, h: 800 }, { w: 2000, h: 1000 })
    expect(t).not.toBeNull()
    // Width is the limiting side: 400/2000 = 0.2, times the 5% margin.
    expect(t!.scale).toBeCloseTo(0.19, 6)
    // Centred: equal slack on each side.
    expect(t!.offset.x).toBeCloseTo((400 - 2000 * 0.19) / 2, 6)
    expect(t!.offset.y).toBeCloseTo((800 - 1000 * 0.19) / 2, 6)
  })

  it('refuses an unlaid-out viewport and an empty image', () => {
    expect(fitTransform({ w: 0, h: 0 }, { w: 100, h: 100 })).toBeNull()
    expect(fitTransform({ w: 800, h: 600 }, { w: 0, h: 100 })).toBeNull()
  })
})

describe('zoomAbout', () => {
  const imagePointUnder = (t: { scale: number; offset: { x: number; y: number } }, p: { x: number; y: number }) => ({
    x: (p.x - t.offset.x) / t.scale,
    y: (p.y - t.offset.y) / t.scale,
  })

  it('keeps the image point under the anchor stationary', () => {
    const before = { scale: 0.5, offset: { x: 120, y: -40 } }
    const anchor = { x: 300, y: 220 }
    const under = imagePointUnder(before, anchor)
    const after = zoomAbout(before, 1.25, anchor)
    expect(after.scale).toBeCloseTo(0.625, 9)
    const underAfter = imagePointUnder(after, anchor)
    expect(underAfter.x).toBeCloseTo(under.x, 9)
    expect(underAfter.y).toBeCloseTo(under.y, 9)
  })

  it('is a no-op at the clamp, offset included', () => {
    const atMax = { scale: MAX_SCALE, offset: { x: 5, y: 7 } }
    expect(zoomAbout(atMax, 2, { x: 0, y: 0 })).toBe(atMax)
  })
})
