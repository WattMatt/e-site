// @vitest-environment node
import { describe, it, expect } from 'vitest'
import { isPrimaryDrawPress, isPanPress, classifyWheel, isTouchEvent } from './canvas-input'

/**
 * FIXTURE DISCIPLINE — every case below is chosen so a plausible WRONG
 * implementation fails it. The three wrong implementations this guards:
 *
 *  1. `evt.button !== 0 → return`, which bricks touch (a TouchEvent has no
 *     `button`, and `undefined !== 0`). Hence the touch cases carry NO button
 *     property at all rather than `button: 0` — seeding a button would make the
 *     assertion pass against the broken guard and prove nothing.
 *  2. `buttons === 1` confused with `button === 1`. The first is the bitmask
 *     for "primary held", the second is the middle button. Hence a case that
 *     pins middle as 1 and asserts primary is NOT a pan.
 *  3. The shipped wheel handler, `deltaY < 0 ? 1.1 : 1/1.1`. Hence the
 *     horizontal-swipe and zero-delta cases, which are exactly where it was
 *     wrong and where a sign-only test cannot tell the difference.
 */

const touch = (type = 'touchstart') => ({ type })
const mouse = (button: number) => ({ type: 'mousedown', button })

describe('isPrimaryDrawPress — the guard that must not brick the tablet', () => {
  it('lets every touch through, even though a TouchEvent has no button', () => {
    // The whole point. `button` is absent, not zero.
    expect(isTouchEvent(touch())).toBe(true)
    expect(isPrimaryDrawPress(touch())).toBe(true)
    expect(isPrimaryDrawPress(touch('touchmove'))).toBe(true)
    expect(isPrimaryDrawPress(touch('touchend'))).toBe(true)
  })

  it('lets the primary mouse button draw', () => {
    expect(isPrimaryDrawPress(mouse(0))).toBe(true)
  })

  it('stops middle and right from firing the tool', () => {
    // Today these place a pin, open window.prompt, replace a calibration
    // point, append a route vertex, or erase.
    expect(isPrimaryDrawPress(mouse(1))).toBe(false)
    expect(isPrimaryDrawPress(mouse(2))).toBe(false)
  })

  it('stops a pen barrel button and eraser end from drawing', () => {
    expect(isPrimaryDrawPress({ type: 'mousedown', button: 2 })).toBe(false)
    expect(isPrimaryDrawPress({ type: 'mousedown', button: 5 })).toBe(false)
  })
})

describe('isPanPress — middle button only', () => {
  it('pans on the middle button', () => {
    expect(isPanPress(mouse(1))).toBe(true)
  })

  it('does not pan on primary or secondary', () => {
    // If this ever returns true for 0, left-drag stops drawing entirely.
    expect(isPanPress(mouse(0))).toBe(false)
    expect(isPanPress(mouse(2))).toBe(false)
  })

  it('never pans from touch — two fingers is a different path', () => {
    expect(isPanPress(touch())).toBe(false)
  })

  it('draw and pan are mutually exclusive for every button', () => {
    for (const b of [0, 1, 2, 3, 4, 5]) {
      const e = mouse(b)
      expect(isPrimaryDrawPress(e) && isPanPress(e)).toBe(false)
    }
  })
})

describe('classifyWheel — the trackpad defect', () => {
  it('zooms a plain mouse wheel, which the owner asked to keep', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: -120, ctrlKey: false })).toEqual({ kind: 'zoom', factor: 1.1 })
    const out = classifyWheel({ deltaX: 0, deltaY: 120, ctrlKey: false })
    expect(out.kind).toBe('zoom')
    expect((out as { factor: number }).factor).toBeCloseTo(1 / 1.1, 10)
  })

  it('zooms a trackpad pinch (ctrl+wheel), in both directions', () => {
    expect(classifyWheel({ deltaX: 0, deltaY: -4, ctrlKey: true }).kind).toBe('zoom')
    expect(classifyWheel({ deltaX: 0, deltaY: 4, ctrlKey: true }).kind).toBe('zoom')
  })

  it('PANS a horizontal two-finger swipe instead of zooming out', () => {
    // The shipped handler returned zoom-out here, because deltaY is 0 and
    // `0 < 0` is false. This is the single most absurd behaviour on a Mac.
    const right = classifyWheel({ deltaX: 40, deltaY: 0, ctrlKey: false })
    expect(right.kind).toBe('pan')
    const left = classifyWheel({ deltaX: -40, deltaY: 0, ctrlKey: false })
    expect(left.kind).toBe('pan')
    // Opposite swipes must move the sheet opposite ways, or it is not a pan.
    expect((right as { dx: number }).dx).toBe(-(left as { dx: number }).dx)
    expect((right as { dx: number }).dx).not.toBe(0)
  })

  it('treats a diagonal swipe by its dominant axis', () => {
    expect(classifyWheel({ deltaX: 50, deltaY: 5, ctrlKey: false }).kind).toBe('pan')
    expect(classifyWheel({ deltaX: 5, deltaY: 50, ctrlKey: false }).kind).toBe('zoom')
  })

  it('does nothing at all on a zero-delta event', () => {
    // The old sign-only test zoomed OUT on this.
    expect(classifyWheel({ deltaX: 0, deltaY: 0, ctrlKey: false })).toEqual({ kind: 'pan', dx: 0, dy: 0 })
  })

  it('a pinch outranks a horizontal component', () => {
    expect(classifyWheel({ deltaX: 99, deltaY: -2, ctrlKey: true }).kind).toBe('zoom')
  })
})

describe('the fixtures can actually fail', () => {
  it('the shipped wheel handler disagrees on exactly the cases that matter', () => {
    const shipped = (d: { deltaY: number }) => (d.deltaY < 0 ? 1.1 : 1 / 1.1)
    // Agrees on a plain wheel...
    expect(shipped({ deltaY: -120 })).toBe(1.1)
    // ...and is wrong on both trackpad cases, which is why they are tested.
    expect(shipped({ deltaY: 0 })).toBeCloseTo(1 / 1.1, 10) // horizontal swipe -> zoom OUT
    expect(classifyWheel({ deltaX: 40, deltaY: 0, ctrlKey: false }).kind).toBe('pan')
  })

  it('the naive button guard would fail the touch cases above', () => {
    const naive = (e: { button?: number }) => e.button === 0
    expect(naive(touch() as { button?: number })).toBe(false) // bricks the tablet
    expect(isPrimaryDrawPress(touch())).toBe(true)
  })
})
