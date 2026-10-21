/**
 * Suggested shop outline from a floor-plan label (spec §4.6).
 *
 * Pure functions over the page bitmap the canvas already holds (2 px per PDF point). From the label's
 * anchor, flood-fill the white space bounded by the drawn walls, grow it to the wall's outer face,
 * trace its outline and simplify it. The gate decides whether the result may be offered: only with a
 * scale, a GLA, no leak, and a fill within GATE_BAND of the GLA. Nothing here saves anything.
 */
import { shapeAreaPx, type Pt } from '@esite/shared/status-plans'

/** Luma below this is ink. Wall lines are black or dark grey; hatching and fills are lighter. */
export const INK_LUMA = 170
/** A region above this share of the page's pixels is the mall, not a shop: abort as a leak. */
export const LEAK_CAP = 0.015
/** The fill stops at the inside face of the wall; GLA is measured further out (spike ran ~0.85 × GLA). */
export const GROW_PX = 2
/** Douglas–Peucker tolerance for the traced outline. */
export const SIMPLIFY_EPS_PX = 2
/** The DB allows 2,000 points; a shop needs far fewer. */
export const MAX_VERTICES = 1000
/** Seed the fill at the anchor and every ±dx × ±dy point around it in `step` px steps. */
export const SEED_GRID = { dx: 24, dy: 16, step: 8 }
/** fill m² / GLA must fall in this band (inclusive) for the outline to be offered. */
export const GATE_BAND = { min: 0.8, max: 1.2 }

/** 1 = ink after a 1 px (3 × 3) dilation, which closes anti-aliased hairline gaps. */
export interface InkMask {
  width: number
  height: number
  ink: Uint8Array
}

/**
 * `pixels` is the region as filled (diagnostics only); `grownPixels` is the region after the
 * GROW_PX growth. The gate measures the polygon, which is what Accept saves. The polygon traces the grown region's outer boundary and drops holes, so before
 * simplification it encloses exactly `grownPixels` only when no hole survives the grow; label text
 * inside a shop normally does survive, and then the polygon encloses `grownPixels` plus the holes.
 * Polygon coordinates are pixel-edge corners in image pixels, flat `[x0, y0, x1, y1, …]`.
 */
export type FillOutcome =
  | { kind: 'ok'; pixels: number; grownPixels: number; polygon: number[] }
  | { kind: 'leak' }
  | { kind: 'no_region' }

export type SuggestionGate =
  | { offered: true; fillM2: number; glaM2: number }
  | { offered: false; reason: string; fillM2: number | null }

// ── Threshold + dilate ────────────────────────────────────────────────────────

/** Luma × 1000 in integers (Rec. 601 weights), composited over white for partial alpha. */
const INK_LUMA_1000 = INK_LUMA * 1000

export function inkMaskFromImageData(d: { width: number; height: number; data: Uint8ClampedArray }): InkMask {
  const { width: w, height: h, data } = d
  const n = w * h
  const raw = new Uint8Array(n)
  for (let i = 0, p = 0; i < n; i++, p += 4) {
    const a = data[p + 3]
    let luma = 299 * data[p] + 587 * data[p + 1] + 114 * data[p + 2]
    if (a !== 255) luma = 255000 - ((255000 - luma) * a) / 255
    if (luma < INK_LUMA_1000) raw[i] = 1
  }
  return { width: w, height: h, ink: dilateSquare(raw, w, h, 1) }
}

/** Square (Chebyshev) dilation by `r`, separable: a horizontal then a vertical max over ±r. */
function dilateSquare(src: Uint8Array, w: number, h: number, r: number): Uint8Array {
  const horiz = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    for (let x = 0; x < w; x++) {
      if (!src[row + x]) continue
      const lo = Math.max(0, x - r)
      const hi = Math.min(w - 1, x + r)
      for (let k = lo; k <= hi; k++) horiz[row + k] = 1
    }
  }
  const out = new Uint8Array(src.length)
  for (let y = 0; y < h; y++) {
    const row = y * w
    const lo = Math.max(0, y - r)
    const hi = Math.min(h - 1, y + r)
    for (let x = 0; x < w; x++) {
      if (!horiz[row + x]) continue
      for (let k = lo; k <= hi; k++) out[k * w + x] = 1
    }
  }
  return out
}

// ── Fill ──────────────────────────────────────────────────────────────────────

interface Region {
  label: number
  count: number
  minX: number
  minY: number
  maxX: number
  maxY: number
}

/**
 * 4-connected scanline fill of non-ink, unvisited pixels from (sx, sy), marking them `label` in
 * `visited`. Returns null (a leak) the moment the count passes `cap`.
 *
 * Also a leak: touching a free pixel that carries another seed's label. A fill that completes covers
 * its whole connected area, so another label next to ours can only be the partial marks of a fill
 * that aborted at the cap in this same area. Treating those marks as walls would report the leftover
 * as a shop with a made-up edge.
 */
function scanlineFill(mask: InkMask, visited: Uint8Array, label: number, sx: number, sy: number, cap: number): Region | null {
  const { width: w, height: h, ink } = mask
  const region: Region = { label, count: 0, minX: sx, minY: sy, maxX: sx, maxY: sy }
  const foreign = (j: number) => visited[j] !== 0 && visited[j] !== label && !ink[j]
  const stack: number[] = [sy * w + sx]
  while (stack.length > 0) {
    const idx = stack.pop() as number
    if (visited[idx] || ink[idx]) continue
    const y = (idx / w) | 0
    const row = y * w
    let l = idx - row
    let r = l
    while (l > 0 && !ink[row + l - 1] && !visited[row + l - 1]) l--
    while (r < w - 1 && !ink[row + r + 1] && !visited[row + r + 1]) r++
    if ((l > 0 && foreign(row + l - 1)) || (r < w - 1 && foreign(row + r + 1))) return null
    visited.fill(label, row + l, row + r + 1)
    region.count += r - l + 1
    if (region.count > cap) return null
    if (l < region.minX) region.minX = l
    if (r > region.maxX) region.maxX = r
    if (y < region.minY) region.minY = y
    if (y > region.maxY) region.maxY = y
    // Push the first pixel of each fillable run in the rows above and below the span.
    for (let ny = y - 1; ny <= y + 1; ny += 2) {
      if (ny < 0 || ny >= h) continue
      const nrow = ny * w
      let inRun = false
      for (let x = l; x <= r; x++) {
        const j = nrow + x
        if (foreign(j)) return null
        const free = !ink[j] && !visited[j]
        if (free && !inRun) stack.push(j)
        inRun = free
      }
    }
  }
  return region
}

/**
 * Every free SEED_GRID point around the anchor (the anchor itself is the grid's centre), nearest
 * first. The whole grid is seeded even when the anchor pixel is free: a free anchor can sit in the
 * 2–4 px gap between two glyphs, whose region is the gap, not the shop.
 */
function seedsFor(mask: InkMask, anchor: Pt): number[] {
  const { width: w, height: h, ink } = mask
  const ax = Math.floor(anchor.x)
  const ay = Math.floor(anchor.y)
  const free = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && !ink[y * w + x]
  const grid: Array<{ idx: number; d2: number }> = []
  for (let oy = -SEED_GRID.dy; oy <= SEED_GRID.dy; oy += SEED_GRID.step) {
    for (let ox = -SEED_GRID.dx; ox <= SEED_GRID.dx; ox += SEED_GRID.step) {
      if (free(ax + ox, ay + oy)) grid.push({ idx: (ay + oy) * w + ax + ox, d2: ox * ox + oy * oy })
    }
  }
  return grid.sort((a, b) => a.d2 - b.d2).map((s) => s.idx)
}

export function fillFromAnchor(mask: InkMask, anchor: Pt): FillOutcome {
  const { width: w, height: h } = mask
  const seeds = seedsFor(mask, anchor)
  if (seeds.length === 0) return { kind: 'no_region' }

  const cap = Math.floor(LEAK_CAP * w * h)
  const visited = new Uint8Array(w * h)
  // Keep the largest region that stays under the cap (spec §4.6). Labels 1..n; a leaked fill keeps
  // its partial marks under its own label, so it is never chosen, and any later fill that reaches
  // those marks is a leak too (see scanlineFill).
  // Labels live in a Uint8Array, so the grid must stay within 255 seeds.
  if (seeds.length > 255) throw new Error('SEED_GRID yields more than 255 seeds; the label store is a Uint8Array.')
  let best: Region | null = null
  let leaked = false
  seeds.forEach((idx, i) => {
    if (visited[idx]) return
    const region = scanlineFill(mask, visited, i + 1, idx % w, (idx / w) | 0, cap)
    if (region === null) leaked = true
    else if (best === null || region.count > best.count) best = region
  })
  if (best === null) return leaked ? { kind: 'leak' } : { kind: 'no_region' }
  return outline(mask, visited, best)
}

// ── Grow, trace, simplify ─────────────────────────────────────────────────────

function outline(mask: InkMask, visited: Uint8Array, region: Region): FillOutcome {
  const { width: w, height: h } = mask
  // Work in a window around the region, grown by GROW_PX and clamped to the page.
  const x0 = Math.max(0, region.minX - GROW_PX)
  const y0 = Math.max(0, region.minY - GROW_PX)
  const x1 = Math.min(w - 1, region.maxX + GROW_PX)
  const y1 = Math.min(h - 1, region.maxY + GROW_PX)
  const ww = x1 - x0 + 1
  const wh = y1 - y0 + 1
  const local = new Uint8Array(ww * wh)
  for (let y = region.minY; y <= region.maxY; y++) {
    const src = y * w
    const dst = (y - y0) * ww - x0
    for (let x = region.minX; x <= region.maxX; x++) if (visited[src + x] === region.label) local[dst + x] = 1
  }
  const grown = dilateSquare(local, ww, wh, GROW_PX)
  let grownPixels = 0
  for (let i = 0; i < grown.length; i++) grownPixels += grown[i]

  const traced = traceOuterEdges(grown, ww, wh)
  // Over the cap: double ε and simplify again.
  let eps = SIMPLIFY_EPS_PX
  let polygon = simplifyClosed(traced, eps)
  while (polygon.length / 2 > MAX_VERTICES) {
    eps *= 2
    polygon = simplifyClosed(traced, eps)
  }
  for (let i = 0; i < polygon.length; i += 2) {
    polygon[i] += x0
    polygon[i + 1] += y0
  }
  return { kind: 'ok', pixels: region.count, grownPixels, polygon }
}

// Directions in image coordinates (y down): east, south, west, north. Right turn = +1.
const DX = [1, 0, -1, 0]
const DY = [0, 1, 0, -1]

/**
 * Follow the outer boundary of the mask along pixel edges, keeping the region on the right (a
 * clockwise walk on screen). Starts at the top-left corner of the top-most, left-most pixel heading
 * east. Diagonal neighbours count as connected, so the walk goes around the whole outer contour and
 * holes are never entered. Returns only the corners where the direction changes, as flat integer
 * corner coordinates; the polygon's area equals the mask's pixels plus any holes it encloses.
 */
function traceOuterEdges(m: Uint8Array, w: number, h: number): number[] {
  const at = (x: number, y: number) => x >= 0 && y >= 0 && x < w && y < h && m[y * w + x] === 1
  let start = -1
  for (let i = 0; i < m.length; i++) {
    if (m[i]) {
      start = i
      break
    }
  }
  if (start < 0) return []
  const sx = start % w
  const sy = (start / w) | 0

  const out: number[] = [sx, sy]
  let cx = sx + 1
  let cy = sy
  let d = 0
  // A walk around a w × h window cannot take more steps than its edges.
  const maxSteps = 4 * (w + 1) * (h + 1)
  for (let step = 0; step < maxSteps; step++) {
    // The two pixels ahead of corner (cx, cy) when facing d: ahead-left and ahead-right.
    let alx: number, aly: number, arx: number, ary: number
    if (d === 0) { alx = cx; aly = cy - 1; arx = cx; ary = cy }
    else if (d === 1) { alx = cx; aly = cy; arx = cx - 1; ary = cy }
    else if (d === 2) { alx = cx - 1; aly = cy; arx = cx - 1; ary = cy - 1 }
    else { alx = cx - 1; aly = cy - 1; arx = cx; ary = cy - 1 }
    let nd: number
    if (at(alx, aly)) nd = (d + 3) % 4
    else if (at(arx, ary)) nd = d
    else nd = (d + 1) % 4
    if (cx === sx && cy === sy) break // back at the start; its corner is already recorded
    if (nd !== d) out.push(cx, cy)
    d = nd
    cx += DX[d]
    cy += DY[d]
  }
  return out
}

/**
 * Douglas–Peucker on a closed ring: split at vertex 0 and the vertex farthest from it, simplify each
 * chain with an explicit stack, and keep the flagged vertices in order.
 */
function simplifyClosed(flat: number[], eps: number): number[] {
  const n = flat.length / 2
  if (n <= 3) return flat.slice()
  let far = 0
  let farD = -1
  for (let i = 1; i < n; i++) {
    const dx = flat[2 * i] - flat[0]
    const dy = flat[2 * i + 1] - flat[1]
    const d2 = dx * dx + dy * dy
    if (d2 > farD) {
      farD = d2
      far = i
    }
  }
  const keep = new Uint8Array(n)
  keep[0] = 1
  keep[far] = 1
  const eps2 = eps * eps
  // Ranges are [a, b] on the ring, with b = n meaning vertex 0 again.
  const stack: number[] = [0, far, far, n]
  while (stack.length > 0) {
    const b = stack.pop() as number
    const a = stack.pop() as number
    if (b - a < 2) continue
    const ax = flat[2 * a]
    const ay = flat[2 * a + 1]
    const bx = flat[2 * (b % n)]
    const by = flat[2 * (b % n) + 1]
    let worst = -1
    let worstD = -1
    for (let i = a + 1; i < b; i++) {
      const d2 = segmentDistSq(flat[2 * i], flat[2 * i + 1], ax, ay, bx, by)
      if (d2 > worstD) {
        worstD = d2
        worst = i
      }
    }
    if (worstD > eps2) {
      keep[worst] = 1
      stack.push(a, worst, worst, b)
    }
  }
  const out: number[] = []
  for (let i = 0; i < n; i++) if (keep[i]) out.push(flat[2 * i], flat[2 * i + 1])
  return out
}

function segmentDistSq(px: number, py: number, ax: number, ay: number, bx: number, by: number): number {
  const vx = bx - ax
  const vy = by - ay
  const len2 = vx * vx + vy * vy
  let t = len2 === 0 ? 0 : ((px - ax) * vx + (py - ay) * vy) / len2
  if (t < 0) t = 0
  else if (t > 1) t = 1
  const dx = px - (ax + t * vx)
  const dy = py - (ay + t * vy)
  return dx * dx + dy * dy
}

// ── Gate ──────────────────────────────────────────────────────────────────────

const m2 = (v: number) => v.toFixed(1)

/**
 * Fails closed. The drawing's own failures (leak, no white space) are reported first because no
 * calibration or schedule edit would change them; then scale, then GLA, then the band.
 */
export function gateSuggestion(outcome: FillOutcome, pixelsPerMeter: number | null, glaM2: number | null): SuggestionGate {
  if (outcome.kind === 'leak') return { offered: false, reason: 'The fill ran into the mall; draw this shop by hand.', fillM2: null }
  if (outcome.kind === 'no_region') return { offered: false, reason: 'No white space at the label.', fillM2: null }
  if (pixelsPerMeter == null || !(pixelsPerMeter > 0)) return { offered: false, reason: 'Calibrate the sheet first.', fillM2: null }
  // The polygon Accept would save (grown region plus any holes), not the ungrown fill: the fill stops
  // at the wall's inside face, and GROW_PX exists to move the measured edge out towards the GLA line.
  const fillM2 = shapeAreaPx(outcome.polygon) / (pixelsPerMeter * pixelsPerMeter)
  if (glaM2 == null || !(glaM2 > 0)) return { offered: false, reason: 'No GLA on the schedule for this shop.', fillM2 }
  const ratio = fillM2 / glaM2
  if (ratio < GATE_BAND.min || ratio > GATE_BAND.max) {
    return { offered: false, reason: `The fill came to ${m2(fillM2)} m² for a ${m2(glaM2)} m² shop, not offered.`, fillM2 }
  }
  return { offered: true, fillM2, glaM2 }
}
