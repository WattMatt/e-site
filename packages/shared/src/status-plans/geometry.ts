/**
 * Plane geometry for status plans (spec 2026-10-09 §6). Pure; no I/O.
 *
 * Coordinates are IMAGE PIXELS of the page at the fixed scale-2 raster, flat
 * [x0, y0, x1, y1, …], x right and y DOWN the sheet. Metres only appear in
 * shapeAreaM2, through the page's pixels-per-metre.
 *
 * hatchSegments is the one hatch generator: the Konva canvas and the pdf-lib
 * renderer both draw its output, so screen and PDF show the same lines.
 */
import { flatToPts, polygonArea, pointInPolygon } from '../solar/layout/geometry'
import type { Pt } from '../solar/layout/types'

export type { Pt }

/** One hatch line, [x0, y0, x1, y1] in image pixels. */
export type Segment = [number, number, number, number]

export interface Box {
  minX: number
  minY: number
  maxX: number
  maxY: number
}

export interface HatchOptions {
  /** Line direction in degrees, measured in image space (y down). */
  angleDeg: number
  /** Perpendicular distance between lines, image pixels. */
  spacing: number
}

/** Normalise a dragged rectangle to four corners: TL, TR, BR, BL. */
export function rectToPoints(x0: number, y0: number, x1: number, y1: number): number[] {
  const l = Math.min(x0, x1)
  const r = Math.max(x0, x1)
  const t = Math.min(y0, y1)
  const b = Math.max(y0, y1)
  return [l, t, r, t, r, b, l, b]
}

export function boundingBox(points: readonly number[]): Box {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (let i = 0; i + 1 < points.length; i += 2) {
    const x = points[i]!
    const y = points[i + 1]!
    if (x < minX) minX = x
    if (y < minY) minY = y
    if (x > maxX) maxX = x
    if (y > maxY) maxY = y
  }
  return { minX, minY, maxX, maxY }
}

/** Absolute shoelace area in square image pixels. */
export function shapeAreaPx(points: readonly number[]): number {
  return polygonArea(flatToPts(points))
}

/** Area in m², or null when the page has no usable scale. Never stored: a scale can be recalibrated. */
export function shapeAreaM2(points: readonly number[], pixelsPerMeter: number | null | undefined): number | null {
  if (pixelsPerMeter == null || !(pixelsPerMeter > 0)) return null
  return shapeAreaPx(points) / (pixelsPerMeter * pixelsPerMeter)
}

export function pointInShape(x: number, y: number, points: readonly number[]): boolean {
  return pointInPolygon({ x, y }, flatToPts(points))
}

function segmentDistanceSq(px: number, py: number, a: Pt, b: Pt): number {
  let x = a.x
  let y = a.y
  let dx = b.x - x
  let dy = b.y - y
  if (dx !== 0 || dy !== 0) {
    const t = ((px - x) * dx + (py - y) * dy) / (dx * dx + dy * dy)
    if (t > 1) {
      x = b.x
      y = b.y
    } else if (t > 0) {
      x += dx * t
      y += dy * t
    }
  }
  dx = px - x
  dy = py - y
  return dx * dx + dy * dy
}

function signedDistance(x: number, y: number, pts: readonly Pt[]): number {
  let inside = false
  let minSq = Infinity
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    if ((a.y > y) !== (b.y > y) && x < ((b.x - a.x) * (y - a.y)) / (b.y - a.y) + a.x) inside = !inside
    minSq = Math.min(minSq, segmentDistanceSq(x, y, a, b))
  }
  if (minSq === 0) return 0
  return (inside ? 1 : -1) * Math.sqrt(minSq)
}

/** Distance from a point to the shape's outline: positive inside, negative outside, 0 on it. */
export function distanceToEdge(x: number, y: number, points: readonly number[]): number {
  return signedDistance(x, y, flatToPts(points))
}

// ── Visual centre: pole of inaccessibility (the polylabel method) ─────────

interface Cell {
  x: number
  y: number
  h: number
  d: number
  max: number
}

function makeCell(x: number, y: number, h: number, pts: readonly Pt[]): Cell {
  const d = signedDistance(x, y, pts)
  return { x, y, h, d, max: d + h * Math.SQRT2 }
}

function heapPush(heap: Cell[], c: Cell): void {
  heap.push(c)
  let i = heap.length - 1
  while (i > 0) {
    const p = (i - 1) >> 1
    if (heap[p]!.max >= heap[i]!.max) break
    const tmp = heap[p]!
    heap[p] = heap[i]!
    heap[i] = tmp
    i = p
  }
}

function heapPop(heap: Cell[]): Cell {
  const top = heap[0]!
  const last = heap.pop()!
  if (heap.length > 0) {
    heap[0] = last
    let i = 0
    for (;;) {
      const l = 2 * i + 1
      const r = l + 1
      let m = i
      if (l < heap.length && heap[l]!.max > heap[m]!.max) m = l
      if (r < heap.length && heap[r]!.max > heap[m]!.max) m = r
      if (m === i) break
      const tmp = heap[m]!
      heap[m] = heap[i]!
      heap[i] = tmp
      i = m
    }
  }
  return top
}

function areaCentroid(pts: readonly Pt[]): Pt {
  let area = 0
  let cx = 0
  let cy = 0
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const a = pts[i]!
    const b = pts[j]!
    const f = a.x * b.y - b.x * a.y
    cx += (a.x + b.x) * f
    cy += (a.y + b.y) * f
    area += f * 3
  }
  if (area === 0) return pts[0]!
  return { x: cx / area, y: cy / area }
}

/**
 * The point inside the shape farthest from its outline, within `precision`
 * image pixels: where a label fits best. Unlike the vertex mean it is inside
 * concave shapes (a C, an L, a mall unit wrapped round a service core).
 */
export function visualCentre(points: readonly number[], precision = 1): Pt {
  if (!(precision > 0)) throw new Error('precision must be positive')
  const pts = flatToPts(points)
  const { minX, minY, maxX, maxY } = boundingBox(points)
  const width = maxX - minX
  const height = maxY - minY
  const cellSize = Math.min(width, height)
  if (!(cellSize > 0)) return { x: minX, y: minY }

  const heap: Cell[] = []
  let h = cellSize / 2
  for (let x = minX; x < maxX; x += cellSize) {
    for (let y = minY; y < maxY; y += cellSize) heapPush(heap, makeCell(x + h, y + h, h, pts))
  }

  const centroid = areaCentroid(pts)
  let best = makeCell(centroid.x, centroid.y, 0, pts)
  const boxCell = makeCell(minX + width / 2, minY + height / 2, 0, pts)
  if (boxCell.d > best.d) best = boxCell

  while (heap.length > 0) {
    const cell = heapPop(heap)
    if (cell.d > best.d) best = cell
    if (cell.max - best.d <= precision) continue
    h = cell.h / 2
    heapPush(heap, makeCell(cell.x - h, cell.y - h, h, pts))
    heapPush(heap, makeCell(cell.x + h, cell.y - h, h, pts))
    heapPush(heap, makeCell(cell.x - h, cell.y + h, h, pts))
    heapPush(heap, makeCell(cell.x + h, cell.y + h, h, pts))
  }
  return { x: best.x, y: best.y }
}

// ── Hatch clipping ─────────────────────────────────────────────────────────

const noNegZero = (n: number) => (n === 0 ? 0 : n)

/**
 * Parallel hatch lines clipped to the shape (concave shapes included, by
 * even-odd pairing). Lines sit at v = (k + 0.5) × spacing in the rotated frame,
 * a GLOBAL phase, so two touching shapes' hatches continue across the seam.
 */
export function hatchSegments(points: readonly number[], opts: HatchOptions): Segment[] {
  if (!(opts.spacing > 0)) throw new Error('spacing must be positive')
  const pts = flatToPts(points)
  if (pts.length < 3) return []

  const t = (opts.angleDeg * Math.PI) / 180
  const cos = Math.cos(t)
  const sin = Math.sin(t)
  // Rotate by -t: lines of direction t become lines of constant v.
  const rot = pts.map((p) => ({ u: p.x * cos + p.y * sin, v: -p.x * sin + p.y * cos }))
  let minV = Infinity
  let maxV = -Infinity
  for (const p of rot) {
    if (p.v < minV) minV = p.v
    if (p.v > maxV) maxV = p.v
  }

  const out: Segment[] = []
  for (let k = Math.floor(minV / opts.spacing - 0.5); (k + 0.5) * opts.spacing < maxV; k++) {
    const v = (k + 0.5) * opts.spacing
    if (v <= minV) continue
    const us: number[] = []
    for (let i = 0, j = rot.length - 1; i < rot.length; j = i++) {
      const a = rot[i]!
      const b = rot[j]!
      if ((a.v > v) !== (b.v > v)) us.push(a.u + ((v - a.v) * (b.u - a.u)) / (b.v - a.v))
    }
    us.sort((a, b) => a - b)
    for (let m = 0; m + 1 < us.length; m += 2) {
      const u0 = us[m]!
      const u1 = us[m + 1]!
      if (u1 - u0 < 1e-9) continue
      out.push([
        noNegZero(u0 * cos - v * sin),
        noNegZero(u0 * sin + v * cos),
        noNegZero(u1 * cos - v * sin),
        noNegZero(u1 * sin + v * cos),
      ])
    }
  }
  return out
}
