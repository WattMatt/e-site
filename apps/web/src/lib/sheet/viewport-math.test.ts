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

import { viewportKeyAction, DEFAULT_FIT_KEYS } from './viewport-math'

describe('viewportKeyAction', () => {
  it('defaults: F, f and 0 fit; + = zoom in; - _ zoom out', () => {
    expect(DEFAULT_FIT_KEYS).toEqual(['f', 'F', '0'])
    expect(viewportKeyAction('f', DEFAULT_FIT_KEYS)).toBe('fit')
    expect(viewportKeyAction('0', DEFAULT_FIT_KEYS)).toBe('fit')
    expect(viewportKeyAction('=', DEFAULT_FIT_KEYS)).toBe('in')
    expect(viewportKeyAction('_', DEFAULT_FIT_KEYS)).toBe('out')
    expect(viewportKeyAction('x', DEFAULT_FIT_KEYS)).toBeNull()
  })
  it('a canvas that needs F for a tool keeps only 0 for fit', () => {
    expect(viewportKeyAction('f', ['0'])).toBeNull()
    expect(viewportKeyAction('F', ['0'])).toBeNull()
    expect(viewportKeyAction('0', ['0'])).toBe('fit')
  })
})

import { fitToBox, MIN_SCALE } from './viewport-math'

describe('fitToBox', () => {
  const vp = { w: 800, h: 600 }
  const centreOnScreen = (t: { scale: number; offset: { x: number; y: number } }, box: { minX: number; minY: number; maxX: number; maxY: number }) => ({
    x: t.offset.x + ((box.minX + box.maxX) / 2) * t.scale,
    y: t.offset.y + ((box.minY + box.maxY) / 2) * t.scale,
  })

  it('the box fills 60 % of the limiting side and sits in the middle of the view', () => {
    const box = { minX: 1000, minY: 2000, maxX: 1200, maxY: 2100 } // 200 × 100: width limits (800/200 < 600/100)
    const t = fitToBox(vp, box)!
    expect(t.scale).toBeCloseTo((800 / 200) * 0.6, 9)
    const c = centreOnScreen(t, box)
    expect(c.x).toBeCloseTo(400, 6)
    expect(c.y).toBeCloseTo(300, 6)
  })

  it('a box at the sheet\'s edge is still centred (the sheet may slide off-screen)', () => {
    const box = { minX: 0, minY: 0, maxX: 100, maxY: 100 }
    const t = fitToBox(vp, box)!
    const c = centreOnScreen(t, box)
    expect(c.x).toBeCloseTo(400, 6)
    expect(c.y).toBeCloseTo(300, 6)
    expect(t.offset.x).toBeGreaterThan(0)
  })

  it('a tiny box is clamped to MAX_SCALE, a huge one to MIN_SCALE; fill is honoured', () => {
    expect(fitToBox(vp, { minX: 10, minY: 10, maxX: 10.5, maxY: 10.5 })!.scale).toBe(MAX_SCALE)
    expect(fitToBox(vp, { minX: 0, minY: 0, maxX: 1e7, maxY: 1e7 })!.scale).toBe(MIN_SCALE)
    expect(fitToBox(vp, { minX: 0, minY: 0, maxX: 800, maxY: 600 }, 1)!.scale).toBeCloseTo(1, 9)
  })

  it('a zero-size box (a point) does not divide by zero', () => {
    expect(fitToBox(vp, { minX: 5, minY: 5, maxX: 5, maxY: 5 })!.scale).toBe(MAX_SCALE)
  })

  it('refuses an unlaid-out view and a box that is not finite', () => {
    expect(fitToBox({ w: 0, h: 0 }, { minX: 0, minY: 0, maxX: 1, maxY: 1 })).toBeNull()
    expect(fitToBox(vp, { minX: Infinity, minY: 0, maxX: -Infinity, maxY: 1 })).toBeNull()
  })
})
