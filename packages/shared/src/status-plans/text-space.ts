/**
 * pdf.js text items → image space (spec §5).
 *
 * Image space is the PDF page rasterised at getViewport({ scale: 2 }), defined
 * in apps/web/src/lib/sheet/use-sheet-image.ts; every status-plan coordinate is
 * stored in it. The caller passes that viewport's `transform`, which already
 * carries the page's /Rotate, so a rotated sheet needs no special case here:
 * the run's raster matrix is viewport ∘ item.
 *
 * Only upright, left-to-right runs are returned. A DB block's labels and
 * values read upright on the sheet as a person sees it; everything else
 * (vertical riser labels, mirrored text) cannot be part of a block.
 */

export type Matrix = readonly [number, number, number, number, number, number]

/** One upright text run on the raster. y grows downwards. */
export interface ImageTextItem {
  str: string
  /** Left edge of the run. */
  x: number
  /** Baseline (pdf.js origin) of the run. */
  baseline: number
  /** baseline − height. */
  top: number
  width: number
  height: number
}

/** m1 ∘ m2: apply m2 first, then m1 (the order of pdf.js Util.transform). */
export function composeMatrix(m1: Matrix, m2: Matrix): Matrix {
  return [
    m1[0] * m2[0] + m1[2] * m2[1],
    m1[1] * m2[0] + m1[3] * m2[1],
    m1[0] * m2[2] + m1[2] * m2[3],
    m1[1] * m2[2] + m1[3] * m2[3],
    m1[0] * m2[4] + m1[2] * m2[5] + m1[4],
    m1[1] * m2[4] + m1[3] * m2[5] + m1[5],
  ]
}

/** A run counts as upright when its direction is within ~5° of +x. */
const MAX_SKEW = 0.09

interface RawTextItem { str: string; transform: number[]; width: number }

function isTextItem(v: unknown): v is RawTextItem {
  if (!v || typeof v !== 'object') return false
  const o = v as Record<string, unknown>
  return (
    typeof o.str === 'string' &&
    Array.isArray(o.transform) &&
    o.transform.length >= 6 &&
    (o.transform as unknown[]).slice(0, 6).every((n) => typeof n === 'number' && Number.isFinite(n)) &&
    typeof o.width === 'number' &&
    Number.isFinite(o.width)
  )
}

export function textItemsToImageSpace(items: readonly unknown[], viewportTransform: Matrix): ImageTextItem[] {
  const out: ImageTextItem[] = []
  const v = viewportTransform
  for (const raw of items) {
    if (!isTextItem(raw)) continue
    const str = raw.str.replace(/\s+/g, ' ').trim()
    if (!str) continue
    const t = raw.transform
    const tx = composeMatrix(v, [t[0], t[1], t[2], t[3], t[4], t[5]])
    if (!(tx[0] > 0) || Math.abs(tx[1]) > MAX_SKEW * tx[0] || !(tx[3] < 0)) continue
    const height = Math.hypot(tx[2], tx[3])
    // item.width is user-space length along the run; scale it by how much the
    // viewport stretches the run's direction.
    const ul = Math.hypot(t[0], t[1]) || 1
    const ux = t[0] / ul
    const uy = t[1] / ul
    const stretch = Math.hypot(v[0] * ux + v[2] * uy, v[1] * ux + v[3] * uy)
    out.push({ str, x: tx[4], baseline: tx[5], top: tx[5] - height, width: raw.width * stretch, height })
  }
  return out
}
