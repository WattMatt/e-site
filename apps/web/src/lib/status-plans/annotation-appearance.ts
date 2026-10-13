/**
 * Which PDF annotations a plan PDF flattens, which appearance it uses, and where it goes
 * (spec 2026-10-13 §3). Pure — no pdf-lib — so every rule is testable on numbers.
 *
 * The rules mirror what the canvas shows: pdf.js 5.7.284's page.render() with its default
 * annotationMode (ENABLE, renderForms false) paints an annotation's normal appearance
 * when it is viewable — not Hidden, not NoView, and (except form-field Widgets) not
 * Invisible. Popup and Link annotations are never painted.
 *
 * The matrix is PDF 32000-1:2008 §12.5.5, as pdf.js implements it (getTransformMatrix):
 * transform the appearance's BBox by its Matrix, take the bounds, and map them onto the
 * annotation's Rect with a scale + translate. Painting the form with `Do` applies its own
 * Matrix, so the caller concatenates only this result.
 */

/** PDF `cm` order: X = a·x + c·y + e, Y = b·x + d·y + f. */
export type Mat = readonly [number, number, number, number, number, number]
export type Quad = readonly [number, number, number, number]

export const IDENTITY: Mat = [1, 0, 0, 1, 0, 0]

/** Annotation flags (PDF 32000 Table 165): bit 1 Invisible, bit 2 Hidden, bit 6 NoView. */
export const ANNOT_FLAG = { invisible: 1, hidden: 2, noView: 32 } as const

export function annotationDrawn(subtype: string | null, flags: number): boolean {
  if (subtype === 'Popup' || subtype === 'Link') return false
  if (flags & (ANNOT_FLAG.hidden | ANNOT_FLAG.noView)) return false
  if (subtype !== 'Widget' && flags & ANNOT_FLAG.invisible) return false
  return true
}

export type ApNormal<T> =
  | { kind: 'stream'; stream: T }
  | { kind: 'states'; states: ReadonlyMap<string, T> }
  | null

/** /AP /N: a stream as-is; a dictionary of states → the /AS entry, or nothing (as pdf.js). */
export function pickAppearance<T>(n: ApNormal<T>, as: string | null): T | null {
  if (!n) return null
  if (n.kind === 'stream') return n.stream
  if (as === null) return null
  return n.states.get(as) ?? null
}

export function normaliseRect(r: Quad): [number, number, number, number] {
  return [Math.min(r[0], r[2]), Math.min(r[1], r[3]), Math.max(r[0], r[2]), Math.max(r[1], r[3])]
}

/** Axis-aligned bounds of a box after a matrix. */
export function transformBox(box: Quad, m: Mat): [number, number, number, number] {
  const pts: Array<[number, number]> = [[box[0], box[1]], [box[2], box[1]], [box[2], box[3]], [box[0], box[3]]]
  const xs = pts.map(([x, y]) => m[0] * x + m[2] * y + m[4])
  const ys = pts.map(([x, y]) => m[1] * x + m[3] * y + m[5])
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)]
}

/** §12.5.5 matrix A: the appearance's transformed BBox → the annotation's Rect. */
export function appearanceMatrix(rect: Quad, bbox: Quad, matrix: Mat): Mat {
  const [rx0, ry0, rx1, ry1] = normaliseRect(rect)
  const [bx0, by0, bx1, by1] = transformBox(bbox, matrix)
  if (bx0 === bx1 || by0 === by1) return [1, 0, 0, 1, rx0, ry0]
  const sx = (rx1 - rx0) / (bx1 - bx0)
  const sy = (ry1 - ry0) / (by1 - by0)
  return [sx, 0, 0, sy, rx0 - bx0 * sx, ry0 - by0 * sy]
}
