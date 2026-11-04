/**
 * pdf.js text items → image space (spec §5).
 *
 * Image space is the PDF page rasterised at getViewport({ scale: 2 }), defined
 * in apps/web/src/lib/sheet/use-sheet-image.ts; every status-plan coordinate is
 * stored in it. The caller passes that viewport's `transform`, which already
 * carries the page's /Rotate, so a rotated sheet needs no special case here:
 * the run's raster matrix is viewport ∘ item.
 *
 * textItemsToImageSpace returns only upright, left-to-right runs. A DB block's
 * labels and values read upright on the sheet as a person sees it; everything
 * else (vertical riser labels, mirrored text) cannot be part of a block.
 *
 * allTextItemsToImageSpace returns every run at any rotation, for readers that
 * only need where a word sits (floor-plan SHOP labels are often turned ±45° or
 * −90°). An upright run comes back exactly as textItemsToImageSpace returns it;
 * any other run becomes the bounding box of its four corners on the raster.
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

interface RawTextItem { str: string; transform: number[]; width: number; height?: unknown }

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

/** A text item with its whitespace collapsed; null for non-text and blank runs. */
function readRun(raw: unknown): { str: string; raw: RawTextItem; t: Matrix } | null {
  if (!isTextItem(raw)) return null
  const str = raw.str.replace(/\s+/g, ' ').trim()
  if (!str) return null
  const t = raw.transform
  return { str, raw, t: [t[0]!, t[1]!, t[2]!, t[3]!, t[4]!, t[5]!] }
}

/** The linear part of m applied to the direction (x, y). */
function applyLinear(m: Matrix, x: number, y: number): [number, number] {
  return [m[0] * x + m[2] * y, m[1] * x + m[3] * y]
}

/** The run's upright image-space item, or null when it is not upright on the raster. */
function uprightRun(str: string, raw: RawTextItem, t: Matrix, v: Matrix): ImageTextItem | null {
  const tx = composeMatrix(v, t)
  if (!(tx[0] > 0) || Math.abs(tx[1]) > MAX_SKEW * tx[0] || !(tx[3] < 0)) return null
  const height = Math.hypot(tx[2], tx[3])
  // item.width is user-space length along the run; scale it by how much the
  // viewport stretches the run's direction.
  const ul = Math.hypot(t[0], t[1]) || 1
  const stretch = Math.hypot(...applyLinear(v, t[0] / ul, t[1] / ul))
  return { str, x: tx[4], baseline: tx[5], top: tx[5] - height, width: raw.width * stretch, height }
}

/**
 * The bounding box on the raster of a run at any angle. In user space the run's
 * corners are o, o + u·width, o + v·height, o + u·width + v·height, with
 * o = (e, f), u = (a, b)/|(a, b)|, v = (c, d)/|(c, d)|; pdf.js reports width as
 * the advance and height as the font size, both in user space. Null for a
 * degenerate transform (no direction along or across the run).
 */
function boxedRun(str: string, raw: RawTextItem, t: Matrix, v: Matrix): ImageTextItem | null {
  const ul = Math.hypot(t[0], t[1])
  const vl = Math.hypot(t[2], t[3])
  if (!(ul > 0) || !(vl > 0)) return null
  const advance = raw.width
  const rise = typeof raw.height === 'number' && Number.isFinite(raw.height) ? raw.height : vl
  const ux = (t[0] / ul) * advance
  const uy = (t[1] / ul) * advance
  const vx = (t[2] / vl) * rise
  const vy = (t[3] / vl) * rise
  const xs: number[] = []
  const ys: number[] = []
  for (const [px, py] of [[0, 0], [ux, uy], [vx, vy], [ux + vx, uy + vy]] as const) {
    const [rx, ry] = applyLinear(v, t[4] + px, t[5] + py)
    xs.push(rx + v[4])
    ys.push(ry + v[5])
  }
  const minX = Math.min(...xs)
  const minY = Math.min(...ys)
  const maxY = Math.max(...ys)
  return { str, x: minX, baseline: maxY, top: minY, width: Math.max(...xs) - minX, height: maxY - minY }
}

export function textItemsToImageSpace(items: readonly unknown[], viewportTransform: Matrix): ImageTextItem[] {
  const out: ImageTextItem[] = []
  for (const item of items) {
    const run = readRun(item)
    if (!run) continue
    const upright = uprightRun(run.str, run.raw, run.t, viewportTransform)
    if (upright) out.push(upright)
  }
  return out
}

/** Every text run on the page, at any rotation. box = bounding box of the run's four corners under the viewport transform. */
export function allTextItemsToImageSpace(items: readonly unknown[], viewportTransform: Matrix): ImageTextItem[] {
  const out: ImageTextItem[] = []
  for (const item of items) {
    const run = readRun(item)
    if (!run) continue
    const placed =
      uprightRun(run.str, run.raw, run.t, viewportTransform) ?? boxedRun(run.str, run.raw, run.t, viewportTransform)
    if (placed) out.push(placed)
  }
  return out
}
