/**
 * The two viewport transforms every sheet canvas needs, kept pure so they can
 * be tested without a DOM: fit a sheet into a box, and zoom about a point.
 *
 * Coordinates: `offset` is the Stage's x/y in screen pixels, `scale` is the
 * Stage's uniform scale. An image-space point p appears on screen at
 * `offset + p * scale`.
 */

export type Transform = { scale: number; offset: { x: number; y: number } }

export const MIN_SCALE = 0.05
export const MAX_SCALE = 8

/**
 * Fit the whole sheet inside the viewport with a 5% margin, centred. Null when
 * the viewport is not laid out yet or the image has no size — the caller keeps
 * whatever transform it has rather than snapping to garbage.
 */
export function fitTransform(
  viewport: { w: number; h: number },
  image: { w: number; h: number },
): Transform | null {
  if (image.w <= 0 || image.h <= 0 || viewport.w < 50 || viewport.h < 50) return null
  const scale = Math.min(viewport.w / image.w, viewport.h / image.h) * 0.95
  return {
    scale,
    offset: { x: (viewport.w - image.w * scale) / 2, y: (viewport.h - image.h * scale) / 2 },
  }
}

/** An axis-aligned box in image space (structurally the same as @esite/shared's status-plan Box). */
export interface ViewBox { minX: number; minY: number; maxX: number; maxY: number }

/**
 * "Show on drawing": zoom so `box` fills `fill` of the view's limiting side, centred.
 * Clamped to [MIN_SCALE, MAX_SCALE]; a box smaller than 1 px counts as 1 px. Null when
 * the view is not laid out or the box is not finite (e.g. boundingBox of no points).
 */
export function fitToBox(viewport: { w: number; h: number }, box: ViewBox, fill = 0.6): Transform | null {
  if (viewport.w < 50 || viewport.h < 50) return null
  if (![box.minX, box.minY, box.maxX, box.maxY].every(Number.isFinite)) return null
  const bw = Math.max(1, box.maxX - box.minX)
  const bh = Math.max(1, box.maxY - box.minY)
  const scale = Math.min(MAX_SCALE, Math.max(MIN_SCALE, Math.min(viewport.w / bw, viewport.h / bh) * fill))
  const cx = (box.minX + box.maxX) / 2
  const cy = (box.minY + box.maxY) / 2
  return { scale, offset: { x: viewport.w / 2 - cx * scale, y: viewport.h / 2 - cy * scale } }
}

/**
 * Multiply the scale by `factor`, keeping `anchor` (container-local CSS
 * pixels) stationary on screen. Clamped to [MIN_SCALE, MAX_SCALE]; at a clamp
 * the transform is returned unchanged so a wheel tick at the limit is a no-op.
 */
export function zoomAbout(current: Transform, factor: number, anchor: { x: number; y: number }): Transform {
  const prev = current.scale
  const next = Math.min(MAX_SCALE, Math.max(MIN_SCALE, prev * factor))
  if (next === prev) return current
  const ratio = next / prev
  const o = current.offset
  return {
    scale: next,
    offset: { x: anchor.x - (anchor.x - o.x) * ratio, y: anchor.y - (anchor.y - o.y) * ratio },
  }
}

/** The keys that fit the sheet unless a canvas needs one of them for a tool. */
export const DEFAULT_FIT_KEYS: readonly string[] = ['f', 'F', '0']

/** What a key does to the viewport, or null. Pure so the rule is testable without a DOM. */
export function viewportKeyAction(key: string, fitKeys: readonly string[]): 'fit' | 'in' | 'out' | null {
  if (fitKeys.includes(key)) return 'fit'
  if (key === '+' || key === '=') return 'in'
  if (key === '-' || key === '_') return 'out'
  return null
}
