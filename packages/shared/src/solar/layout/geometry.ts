/**
 * Plane geometry for the Solar layout (engine spec §3.1). Pure; no I/O.
 *
 * Coordinates are metres on PLAN: x to the right, y DOWN (the sheet's image
 * space divided by its pixels-per-metre). Only pxToM / mToPx know about pixels.
 *
 * Containment is judged by PROPER crossings plus explicit vertex tests, so a
 * module that exactly touches a setback line is allowed and one that crosses
 * an edge anywhere is not. EPS absorbs floating-point noise at the boundary.
 */
import type { Pt } from './types'

export const EPS = 1e-9

export function flatToPts(flat: readonly number[]): Pt[] {
  if (flat.length % 2 !== 0) throw new Error('A point list needs an even number of values')
  const out: Pt[] = []
  for (let i = 0; i < flat.length; i += 2) out.push({ x: flat[i]!, y: flat[i + 1]! })
  return out
}

export function ptsToFlat(pts: readonly Pt[]): number[] {
  return pts.flatMap((p) => [p.x, p.y])
}

export function pxToM(flat: readonly number[], pixelsPerMeter: number): Pt[] {
  if (!(pixelsPerMeter > 0)) throw new Error('pixels per metre must be positive')
  return flatToPts(flat).map((p) => ({ x: p.x / pixelsPerMeter, y: p.y / pixelsPerMeter }))
}

export function mToPx(pts: readonly Pt[], pixelsPerMeter: number): number[] {
  if (!(pixelsPerMeter > 0)) throw new Error('pixels per metre must be positive')
  return pts.flatMap((p) => [p.x * pixelsPerMeter, p.y * pixelsPerMeter])
}

export function distance(a: Pt, b: Pt): number {
  return Math.hypot(a.x - b.x, a.y - b.y)
}

/** Absolute shoelace area. */
export function polygonArea(poly: readonly Pt[]): number {
  let s = 0
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i]!
    const b = poly[(i + 1) % poly.length]!
    s += a.x * b.y - b.x * a.y
  }
  return Math.abs(s) / 2
}

export function vertexMean(poly: readonly Pt[]): Pt {
  const n = poly.length
  return { x: poly.reduce((s, p) => s + p.x, 0) / n, y: poly.reduce((s, p) => s + p.y, 0) / n }
}

/** Even-odd ray cast. A point exactly on an edge may report either way — use onBoundary where it matters. */
export function pointInPolygon(p: Pt, poly: readonly Pt[]): boolean {
  let inside = false
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const a = poly[i]!
    const b = poly[j]!
    if ((a.y > p.y) !== (b.y > p.y) && p.x < ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}

export function pointSegmentDistance(p: Pt, a: Pt, b: Pt): number {
  const vx = b.x - a.x
  const vy = b.y - a.y
  const len2 = vx * vx + vy * vy
  let t = len2 === 0 ? 0 : ((p.x - a.x) * vx + (p.y - a.y) * vy) / len2
  t = Math.max(0, Math.min(1, t))
  return Math.hypot(p.x - a.x - t * vx, p.y - a.y - t * vy)
}

function orient(a: Pt, b: Pt, c: Pt): -1 | 0 | 1 {
  const v = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
  if (Math.abs(v) < EPS) return 0
  return v > 0 ? 1 : -1
}

/** True only for a PROPER crossing: interiors intersect at one point. Touching or collinear overlap is not a crossing. */
export function segmentsCross(a: Pt, b: Pt, c: Pt, d: Pt): boolean {
  return orient(a, b, c) * orient(a, b, d) < 0 && orient(c, d, a) * orient(c, d, b) < 0
}

export function segmentDistance(a: Pt, b: Pt, c: Pt, d: Pt): number {
  if (segmentsCross(a, b, c, d)) return 0
  return Math.min(
    pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
    pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b),
  )
}

function edges(poly: readonly Pt[]): Array<[Pt, Pt]> {
  return poly.map((p, i) => [p, poly[(i + 1) % poly.length]!] as [Pt, Pt])
}

export function onBoundary(p: Pt, poly: readonly Pt[]): boolean {
  return edges(poly).some(([a, b]) => pointSegmentDistance(p, a, b) < EPS)
}

function boundaryDistance(a: readonly Pt[], b: readonly Pt[]): number {
  let m = Infinity
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) m = Math.min(m, segmentDistance(p, q, r, s))
  return m
}

function anyCrossing(a: readonly Pt[], b: readonly Pt[]): boolean {
  for (const [p, q] of edges(a)) for (const [r, s] of edges(b)) if (segmentsCross(p, q, r, s)) return true
  return false
}

const strictlyInside = (p: Pt, poly: readonly Pt[]) => pointInPolygon(p, poly) && !onBoundary(p, poly)

/**
 * A module quad lies inside the roof with at least `clearance` metres to every
 * roof edge: all corners inside (or on) the roof, no roof vertex poking into
 * the quad, no edge crossing, and the boundary gap ≥ clearance.
 */
export function quadInsideRoof(quad: readonly Pt[], roof: readonly Pt[], clearance: number): boolean {
  if (!quad.every((p) => pointInPolygon(p, roof) || onBoundary(p, roof))) return false
  if (roof.some((v) => strictlyInside(v, quad))) return false
  if (anyCrossing(quad, roof)) return false
  return boundaryDistance(quad, roof) >= clearance - EPS
}

/** The quad keeps `clearance` metres from a polygonal obstruction and does not overlap or contain it. */
export function quadClearOfPolygon(quad: readonly Pt[], obstruction: readonly Pt[], clearance: number): boolean {
  if (obstruction.some((v) => strictlyInside(v, quad))) return false
  if (quad.some((p) => pointInPolygon(p, obstruction) || onBoundary(p, obstruction))) return false
  if (anyCrossing(quad, obstruction)) return false
  return boundaryDistance(quad, obstruction) >= clearance - EPS
}

/** The quad keeps radius + clearance from a circular obstruction's centre. */
export function quadClearOfCircle(quad: readonly Pt[], centre: Pt, radius: number, clearance: number): boolean {
  if (pointInPolygon(centre, quad)) return false
  let m = Infinity
  for (const [a, b] of edges(quad)) m = Math.min(m, pointSegmentDistance(centre, a, b))
  return m >= radius + clearance - EPS
}

/** Rotate `p` about `about` by `deg` — clockwise on screen, because image y points down. */
export function rotateAbout(p: Pt, about: Pt, deg: number): Pt {
  const r = (deg * Math.PI) / 180
  const dx = p.x - about.x
  const dy = p.y - about.y
  return { x: about.x + dx * Math.cos(r) - dy * Math.sin(r), y: about.y + dx * Math.sin(r) + dy * Math.cos(r) }
}

/** At least three vertices and no two non-adjacent edges crossing. */
export function isSimplePolygon(poly: readonly Pt[]): boolean {
  if (poly.length < 3) return false
  const e = edges(poly)
  for (let i = 0; i < e.length; i++) {
    for (let j = i + 1; j < e.length; j++) {
      const adjacent = j === i + 1 || (i === 0 && j === e.length - 1)
      if (adjacent) continue
      if (segmentsCross(e[i]![0], e[i]![1], e[j]![0], e[j]![1])) return false
    }
  }
  return polygonArea(poly) > EPS
}

/** Quad from a corner and two unit axis vectors: corner, +w·u, +w·u + h·v, +h·v. */
export function rectQuad(corner: Pt, u: Pt, v: Pt, w: number, h: number): Pt[] {
  return [
    corner,
    { x: corner.x + u.x * w, y: corner.y + u.y * w },
    { x: corner.x + u.x * w + v.x * h, y: corner.y + u.y * w + v.y * h },
    { x: corner.x + v.x * h, y: corner.y + v.y * h },
  ]
}
