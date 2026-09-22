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
