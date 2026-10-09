/**
 * Image space → PDF space for status plans.
 *
 * Image space is what every saved shape is stored in (spec §4): a PDF drawing rasterised by pdf.js at
 * `getViewport({ scale: 2 })` — which APPLIES the page's /Rotate and uses its CropBox — or a raster
 * drawing at its natural pixels (1 px per unit, never rotated). So a stored point is a point on the
 * VIEWED sheet, y down.
 *
 * pdf.js's viewport transform (display/display_utils.js, PageViewport) for viewBox [x0 y0 x1 y1],
 * scale s, rotation r, is, with (u, v) = image px ÷ s:
 *   r=0   u = x − x0,  v = y1 − y        r=180 u = x1 − x,  v = y − y0
 *   r=90  u = y − y0,  v = x − x0        r=270 u = y1 − y,  v = x1 − x
 * imageToPdfPoint is its inverse. The pdf.js oracle test in pdf-geometry.test.ts proves it.
 *
 * pdf-lib's embedPage(bbox) makes a form whose space is source − (x0, y0). placementFor returns the
 * single matrix M that draws that form turned and fitted into a frame, so the embedded drawing and
 * every shape (source point − origin, then M) share one transform and cannot drift apart.
 */

export type QuarterTurn = 0 | 90 | 180 | 270
export interface PageBox { x: number; y: number; width: number; height: number }
export interface Pt { x: number; y: number }
export interface Frame { x: number; y: number; width: number; height: number }
/** PDF `cm` order: X = a·x + c·y + e, Y = b·x + d·y + f. */
export type Matrix = readonly [number, number, number, number, number, number]
export interface Placement {
  matrix: Matrix
  /** Output points per source point. */
  scale: number
  /** Where the viewed sheet sits on the output page. */
  drawn: Frame
}

/** use-sheet-image rasterises PDFs at scale 2. Changing it would move every saved coordinate. */
export const PDF_PX_PER_PT = 2
/** Raster drawings: one image pixel per unit. */
export const IMAGE_PX_PER_PT = 1

/** pdf.js: a /Rotate that is not a multiple of 90 is treated as 0. */
export function normaliseRotation(angle: number): QuarterTurn {
  if (!Number.isFinite(angle) || angle % 90 !== 0) return 0
  return ((((angle % 360) + 360) % 360) as QuarterTurn)
}

export function viewedSize(box: PageBox, rotate: QuarterTurn): { width: number; height: number } {
  return rotate === 90 || rotate === 270
    ? { width: box.height, height: box.width }
    : { width: box.width, height: box.height }
}

/** A stored image-space point → the source page's user space (inverse of pdf.js's viewport). */
export function imageToPdfPoint(pt: Pt, box: PageBox, rotate: QuarterTurn, pxPerPt: number = PDF_PX_PER_PT): Pt {
  const u = pt.x / pxPerPt
  const v = pt.y / pxPerPt
  const x0 = box.x
  const y0 = box.y
  const x1 = box.x + box.width
  const y1 = box.y + box.height
  switch (rotate) {
    case 0: return { x: x0 + u, y: y1 - v }
    case 90: return { x: x0 + v, y: y0 + u }
    case 180: return { x: x1 - u, y: y0 + v }
    case 270: return { x: x1 - v, y: y1 - u }
  }
}

/**
 * Fit the viewed sheet into `frame` (centred, aspect kept) and return the matrix that draws the
 * embedded form there. Derivation (W, H = box size, k = scale, (ox, oy) = drawn origin):
 *   r=0   [ k  0  0  k  ox        oy       ]
 *   r=90  [ 0 −k  k  0  ox        oy + kW  ]
 *   r=180 [−k  0  0 −k  ox + kW   oy + kH  ]
 *   r=270 [ 0  k −k  0  ox + kH   oy       ]
 * i.e. a rotation of −r degrees (PDF /Rotate is clockwise) then a translation.
 */
export function placementFor(box: PageBox, rotate: QuarterTurn, frame: Frame): Placement {
  const v = viewedSize(box, rotate)
  const k = Math.min(frame.width / v.width, frame.height / v.height)
  const dw = v.width * k
  const dh = v.height * k
  const ox = frame.x + (frame.width - dw) / 2
  const oy = frame.y + (frame.height - dh) / 2
  const W = box.width
  const H = box.height
  let matrix: Matrix
  switch (rotate) {
    case 0: matrix = [k, 0, 0, k, ox, oy]; break
    case 90: matrix = [0, -k, k, 0, ox, oy + k * W]; break
    case 180: matrix = [-k, 0, 0, -k, ox + k * W, oy + k * H]; break
    case 270: matrix = [0, k, -k, 0, ox + k * H, oy]; break
  }
  return { matrix, scale: k, drawn: { x: ox, y: oy, width: dw, height: dh } }
}

export function applyMatrix(m: Matrix, p: Pt): Pt {
  return { x: m[0] * p.x + m[2] * p.y + m[4], y: m[1] * p.x + m[3] * p.y + m[5] }
}

/** A stored image-space point → the output page, through the same matrix as the embedded drawing. */
export function imageToOutput(pt: Pt, box: PageBox, rotate: QuarterTurn, placement: Placement, pxPerPt: number = PDF_PX_PER_PT): Pt {
  const s = imageToPdfPoint(pt, box, rotate, pxPerPt)
  return applyMatrix(placement.matrix, { x: s.x - box.x, y: s.y - box.y })
}
