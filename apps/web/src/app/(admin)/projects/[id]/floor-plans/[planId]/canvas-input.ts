/**
 * Which input means "draw", which means "move the sheet", and what a wheel
 * event is asking for.
 *
 * Extracted from MarkupCanvas because these three decisions are where every
 * input defect in this canvas lives, and because Konva cannot be mounted under
 * jsdom (no `canvas` package), so a component test is not available. Precedent:
 * `markup-geometry.ts`, carved out for the same reason.
 *
 * ⚠ THE TRAP THIS MODULE EXISTS TO AVOID. The obvious guard is
 *
 *     if (e.evt.button !== 0) return
 *
 * and it BRICKS THE ENTIRE CANVAS ON A TABLET. `onPointerDown` is bound to both
 * `onMouseDown` and `onTouchStart` (MarkupCanvas), so `e.evt` is a TouchEvent
 * half the time — and a TouchEvent has no `button` at all. `undefined !== 0` is
 * true, so every finger press would return early and nothing would ever draw.
 * The type is checked FIRST here, by event name, which is the idiom this file
 * already uses at the eraser's drag test.
 */

/** The event shape both Konva (`e.evt`) and native listeners hand us. */
export type PressLike = { type: string; button?: number }

/** A touch event carries no button; testing it as a mouse event is the bug. */
export function isTouchEvent(evt: PressLike): boolean {
  return evt.type.startsWith('touch')
}

/**
 * Should the held tool act on this press?
 *
 * Touch always yes (finger presses are the primary action on a tablet). Mouse
 * and pen only on the primary button — so middle and right stop placing pins,
 * opening `window.prompt`, replacing calibration points, appending route
 * vertices and erasing, all of which they do today.
 *
 * A pen's barrel button (2) and eraser end (5) are deliberately NOT drawing
 * presses. Neither has ever been wired to anything in this canvas, so this
 * removes no capability; it just declines to invent one silently.
 */
export function isPrimaryDrawPress(evt: PressLike): boolean {
  if (isTouchEvent(evt)) return true
  return evt.button === 0
}

/**
 * Should this press start a pan?
 *
 * Middle button only, and never from touch — a tablet pans with two fingers,
 * which is a different path entirely. `button === 1` is the middle button in
 * the DOM's numbering (0 primary, 1 auxiliary, 2 secondary), which is NOT the
 * same numbering as `MouseEvent.buttons`, where middle is the bit value 4. The
 * file's existing eraser test uses `buttons === 1`; that is the bitmask and
 * means "primary held". Confusing the two is easy and silent.
 */
export function isPanPress(evt: PressLike): boolean {
  if (isTouchEvent(evt)) return false
  return evt.button === 1
}

export type WheelIntent =
  | { kind: 'zoom'; factor: number }
  | { kind: 'pan'; dx: number; dy: number }

/** How fast one wheel notch zooms. Matches the value this canvas already used. */
const ZOOM_STEP = 1.1

/**
 * What is this wheel event asking for?
 *
 * ⚠ THE DEFECT THIS REPLACES: the handler was
 *
 *     const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1
 *
 * which reads only the SIGN of deltaY and never looks at deltaX or ctrlKey. On
 * a trackpad that means a two-finger swipe up zooms in, down zooms out, and a
 * HORIZONTAL swipe zooms out — because deltaY is 0 and `0 < 0` is false. All
 * four directions of the universal pan gesture zoomed, so there was no pan on a
 * MacBook outside the Select tool.
 *
 * The rules, and why each is safe:
 *
 *  - `ctrlKey` means a pinch. Browsers synthesise ctrl+wheel for a trackpad
 *    pinch, and it is the one unambiguous zoom signal there is. Always zoom.
 *  - A horizontal-dominant event is a pan. A mouse wheel does not produce
 *    deltaX (only a tilt-wheel does, and panning is what a tilt-wheel means
 *    everywhere else too), so this cannot mis-fire on a plain mouse.
 *  - Everything else zooms by deltaY, which PRESERVES the plain mouse wheel the
 *    owner explicitly asked to keep: "the same wheel to zoom and pan".
 *
 * Deliberately NOT attempted: distinguishing a trackpad's vertical two-finger
 * scroll from a mouse wheel. The heuristics (integer multiples of 120, delta
 * magnitude, deltaMode) are unreliable across browsers and OS settings, and
 * guessing wrong would break the mouse wheel — the one interaction that works
 * today. Trackpad users pan with space-drag instead, which is explicit.
 */
export function classifyWheel(e: { deltaX: number; deltaY: number; ctrlKey: boolean }): WheelIntent {
  if (e.ctrlKey) {
    return { kind: 'zoom', factor: e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP }
  }
  if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
    // Screen-space pan. Content follows the fingers, so the offset moves
    // OPPOSITE the scroll delta — the same sign convention as every scroller.
    return { kind: 'pan', dx: -e.deltaX, dy: 0 }
  }
  if (e.deltaY === 0) {
    // Neither axis moved. Zooming on this is how a stray event became a
    // zoom-out under the old sign-only test.
    return { kind: 'pan', dx: 0, dy: 0 }
  }
  return { kind: 'zoom', factor: e.deltaY < 0 ? ZOOM_STEP : 1 / ZOOM_STEP }
}

/**
 * Undo the vertex the FIRST finger of a pinch placed.
 *
 * A pinch is two fingers, but finger one lands alone and is, at that instant,
 * indistinguishable from a deliberate tap to place a vertex. You only learn it
 * was a pinch when finger two arrives — by which time the vertex is committed.
 * Deferring every commit to pointer-up would fix it generally, but that is a
 * restructure of ~15 tool branches, two of which open a blocking
 * `window.prompt` and so cannot observe a second finger at all.
 *
 * For the polyline this is exact and needs no restructure: snapshot the vertex
 * list the moment a finger lands, and if a gesture then starts, cut back to it.
 * No time window, no heuristic — the snapshot IS the pre-touch truth.
 *
 * This is the case that matters most: the server re-measures a cable run from
 * the geometry it is handed, so a phantom vertex is not a cosmetic blemish, it
 * is a wrong length on a signed schedule. Zooming in to place a vertex more
 * accurately was what made the measurement wrong.
 *
 * `points` is flat [x,y,x,y,…], so a length is 2x a vertex count.
 */
export function rollbackPinchVertex(points: number[], snapshotLen: number | null): number[] {
  // No finger-down snapshot: nothing to roll back to. Happens for mouse input,
  // and for a gesture that starts without any press having reached the canvas.
  if (snapshotLen === null) return points
  // A snapshot at or beyond the current length means the finger added nothing
  // (or something else already shortened the list). Leave it alone rather than
  // extending or guessing.
  if (snapshotLen >= points.length) return points
  if (snapshotLen < 0) return points
  return points.slice(0, snapshotLen)
}
