/**
 * Snap a detected DB block onto its table's drawn border (spec §5).
 *
 * detect-blocks.ts builds a block's box from its TEXT. Left, top and bottom
 * land near the table, but the right edge stops at the longest value, short
 * of the table's outer border. Every block is a 7-row × 2-column table drawn
 * with vector lines, so the border is in the drawing: this finds it.
 *
 * The border is the rectangle whose four lines agree with each other:
 *  - top / bottom: horizontal lines just above the NO: row / just below the
 *    CT: row, covering most of the text's width, that START at the left
 *    border and END at the right border;
 *  - left / right: vertical lines spanning the block from top to bottom,
 *    left near the label column, right past the widest value.
 * Requiring the horizontals to end ON the chosen verticals is what skips the
 * label/value divider (the row lines run on past it) and what stops a block
 * whose own right border is missing from reaching a neighbour's.
 *
 * Every tolerance is a multiple of the block's NO: label height. Anything
 * less than a full, consistent rectangle keeps the text box, `snapped: false`.
 */
import { rectToPoints, type Box } from './geometry'
import type { DetectedBlock } from './detect-blocks'
import type { LineSegment } from './line-space'

/** Multiples of the NO: label's height. */
export const SNAP_TOLERANCES = {
  /** A border lies at most this far outside the text on the left, top and bottom. */
  reach: 3,
  /** The right border lies at most this far right of the label column. */
  maxWidth: 30,
  /** A border may sit this far INSIDE the text edge (glyph metrics are approximate). */
  inside: 0.3,
  /** Pieces of one line: offset across the line … */
  collinear: 0.15,
  /** … and gap along it. A border drawn cell by cell has no gap. */
  joinGap: 0.2,
  /** A line ends ON a border, or a border reaches a line, within this. */
  end: 0.4,
  /** A vertical border spans, and a horizontal one covers, this share of the text. */
  span: 0.8,
  /** A second, parallel border line this close outside the first is the same (thick) border. */
  outerPair: 0.4,
} as const

/** How many candidate lines per side are tried, nearest the text first. */
const MAX_CANDIDATES = 8

interface Line { at: number; from: number; to: number }

/** Sorted by `at`, for windowed lookups. */
export interface LineIndex {
  h: LineSegment[]
  v: LineSegment[]
  /** Usable lines on the page (horizontal + vertical). */
  count: number
}

export function buildLineIndex(lines: readonly LineSegment[]): LineIndex {
  const ok = lines.filter((l) => Number.isFinite(l.at) && Number.isFinite(l.from) && Number.isFinite(l.to) && l.to > l.from)
  const h = ok.filter((l) => l.axis === 'h').sort((a, b) => a.at - b.at)
  const v = ok.filter((l) => l.axis === 'v').sort((a, b) => a.at - b.at)
  return { h, v, count: h.length + v.length }
}

function lowerBound(arr: readonly LineSegment[], at: number): number {
  let lo = 0
  let hi = arr.length
  while (lo < hi) {
    const mid = (lo + hi) >> 1
    if (arr[mid]!.at < at) lo = mid + 1
    else hi = mid
  }
  return lo
}

/** Lines with at in [atMin, atMax] overlapping [lo, hi] along the line, collinear pieces joined. */
function linesIn(arr: readonly LineSegment[], atMin: number, atMax: number, lo: number, hi: number, h: number): Line[] {
  const T = SNAP_TOLERANCES
  const raw: LineSegment[] = []
  for (let i = lowerBound(arr, atMin); i < arr.length && arr[i]!.at <= atMax; i++) {
    const s = arr[i]!
    if (s.to >= lo && s.from <= hi) raw.push(s)
  }
  // Group by position across the line, then join pieces along it.
  const out: Line[] = []
  let i = 0
  while (i < raw.length) {
    let j = i + 1
    while (j < raw.length && raw[j]!.at - raw[i]!.at <= T.collinear * h) j++
    const group = raw.slice(i, j).sort((a, b) => a.from - b.from)
    const at = group.reduce((s, g) => s + g.at, 0) / group.length
    let cur: Line = { at, from: group[0]!.from, to: group[0]!.to }
    for (const g of group.slice(1)) {
      if (g.from <= cur.to + T.joinGap * h) cur.to = Math.max(cur.to, g.to)
      else { out.push(cur); cur = { at, from: g.from, to: g.to } }
    }
    out.push(cur)
    i = j
  }
  return out
}

function overlap(l: Line, lo: number, hi: number): number {
  return Math.max(0, Math.min(l.to, hi) - Math.max(l.from, lo))
}

/** Nearest the text first, at most MAX_CANDIDATES. */
function nearest(lines: Line[], ref: number): Line[] {
  return lines.sort((a, b) => Math.abs(a.at - ref) - Math.abs(b.at - ref)).slice(0, MAX_CANDIDATES)
}

interface Rect { top: Line; bottom: Line; left: Line; right: Line }

function consistent(r: Rect, tol: number): boolean {
  for (const hz of [r.top, r.bottom]) {
    if (Math.abs(hz.from - r.left.at) > tol || Math.abs(hz.to - r.right.at) > tol) return false
  }
  for (const vt of [r.left, r.right]) {
    if (vt.from > r.top.at + tol || vt.to < r.bottom.at - tol) return false
  }
  return true
}

/** The table rectangle round one block, or null when the line work does not agree on one. */
export function findTableRect(block: Pick<DetectedBlock, 'text' | 'labelHeight'>, index: LineIndex): Box | null {
  const T = SNAP_TOLERANCES
  const h = block.labelHeight
  const t = block.text
  if (!(h > 0) || index.count === 0) return null
  const width = t.maxX - t.minX
  const height = t.maxY - t.minY
  const xLo = t.minX - T.reach * h
  const xHi = t.minX + T.maxWidth * h
  const ctBaseline = t.maxY - 0.25 * h

  const covers = (l: Line) => overlap(l, t.minX, t.maxX) >= T.span * width
  const spans = (l: Line) => overlap(l, t.minY, t.maxY) >= T.span * height

  const tops = nearest(linesIn(index.h, t.minY - T.reach * h, t.minY + 0.5 * h, xLo, xHi, h).filter(covers), t.minY)
  const bottoms = nearest(linesIn(index.h, ctBaseline - 0.2 * h, t.maxY + T.reach * h, xLo, xHi, h).filter(covers), t.maxY)
  const yLo = t.minY - T.reach * h
  const yHi = t.maxY + T.reach * h
  const lefts = nearest(linesIn(index.v, xLo, t.minX + T.inside * h, yLo, yHi, h).filter(spans), t.minX)
  const rights = nearest(linesIn(index.v, t.maxX - T.inside * h, xHi, yLo, yHi, h).filter(spans), t.maxX)
  if (!tops.length || !bottoms.length || !lefts.length || !rights.length) return null

  const tol = T.end * h
  const found: Rect[] = []
  for (const top of tops) for (const bottom of bottoms) for (const left of lefts) for (const right of rights) {
    const r = { top, bottom, left, right }
    if (right.at - left.at >= 0.5 * width && bottom.at > top.at && consistent(r, tol)) found.push(r)
  }
  if (!found.length) return null

  // The innermost consistent line on each side is the border; a parallel
  // line just outside it is the same thick border, and the outer one wins.
  const pair = T.outerPair * h
  const inTop = Math.max(...found.map((r) => r.top.at))
  const inBottom = Math.min(...found.map((r) => r.bottom.at))
  const inLeft = Math.max(...found.map((r) => r.left.at))
  const inRight = Math.min(...found.map((r) => r.right.at))
  const near = found.filter(
    (r) => inTop - r.top.at <= pair && r.bottom.at - inBottom <= pair && inLeft - r.left.at <= pair && r.right.at - inRight <= pair,
  )
  const area = (r: Rect) => (r.right.at - r.left.at) * (r.bottom.at - r.top.at)
  const best = near.reduce((a, b) => (area(b) > area(a) ? b : a))
  return { minX: best.left.at, minY: best.top.at, maxX: best.right.at, maxY: best.bottom.at }
}

export function snapBlock(block: DetectedBlock, lines: readonly LineSegment[] | LineIndex): DetectedBlock {
  const index = 'count' in lines ? lines : buildLineIndex(lines as readonly LineSegment[])
  const rect = findTableRect(block, index)
  if (!rect) return { ...block, snapped: false }
  return { ...block, box: rect, points: rectToPoints(rect.minX, rect.minY, rect.maxX, rect.maxY), snapped: true }
}

export function snapBlocks(blocks: readonly DetectedBlock[], lines: readonly LineSegment[] | LineIndex): DetectedBlock[] {
  const index = 'count' in lines ? lines : buildLineIndex(lines as readonly LineSegment[])
  return blocks.map((b) => snapBlock(b, index))
}
