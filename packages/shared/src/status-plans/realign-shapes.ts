/**
 * Re-align existing line-diagram blocks to the drawing (owner ask 2026-10-14).
 *
 * Most blocks on the line diagrams were drawn by hand, so their rectangles sit
 * near, not on, the tables they mark. A sheet scan (detect-blocks + snap-blocks)
 * finds each table's drawn border; this pairs every existing RECTANGLE with the
 * table it covers and proposes moving it onto that border. Board links are
 * never changed: a table whose NO: tag reads as a different board is FLAGGED.
 *
 * Pairing rules (each has its own test):
 *  - only SNAPPED tables are targets: a box that follows the text is not the
 *    drawing's border, so it is no reason to move a person's rectangle;
 *  - a shape pairs with a table only when their intersection is at least half
 *    of the SMALLER of the two areas (a rectangle round two tables qualifies
 *    for both — and is then ambiguous, below);
 *  - the best table must be unique: a runner-up within 10 % of the best
 *    (on that same ratio) leaves the shape 'ambiguous';
 *  - one table takes at most one shape: when several shapes pick the same
 *    table, the highest intersection-over-union wins (IoU, because the pairing
 *    ratio is 1.0 for every shape lying inside the table); the rest are
 *    'conflict'. An exact tie leaves them all;
 *  - polygons, and outlines that are not four readable corners, are skipped.
 *
 * 'unchanged' = every edge already within 1 image px of the border.
 * distancePx = the furthest any edge of the bounding box moves.
 */
import { boundingBox, rectToPoints, type Box } from './geometry'
import { buildNodeIndex, matchBlock, type MatchableNode } from './match-nodes'
import type { ShapeKind } from './types'

export const REALIGN_RULES = {
  /** Intersection ÷ the smaller area, at least. */
  minOverlap: 0.5,
  /** A runner-up at or above this share of the best makes the pairing ambiguous. */
  runnerUp: 0.9,
  /** Image px within which an edge counts as already on the border. */
  alignedPx: 1,
} as const

export interface RealignShape {
  id: string
  shape: ShapeKind
  points: readonly number[]
  nodeId: string | null
  updatedAt: string
}

/** A scanned table (DetectedBlock satisfies this). */
export interface RealignDetected {
  box: Box
  tag: string | null
  name?: string | null
  snapped: boolean
}

export interface LinkMismatch {
  /** The table's NO: text. */
  tableTag: string
  /** The board that tag matches. */
  suggestedNodeId: string
}

interface Base { shapeId: string; nodeId: string | null }
interface Paired extends Base {
  /** Index into the detected list. */
  tableIndex: number
  linkMismatch?: LinkMismatch
}

export type RealignResult =
  | (Paired & { kind: 'move'; from: number[]; to: number[]; distancePx: number; expectedUpdatedAt: string })
  | (Paired & { kind: 'unchanged' })
  | (Base & { kind: 'no_table' | 'ambiguous' | 'conflict'; linkMismatch?: undefined })

export interface RealignSummaryCounts {
  move: number
  unchanged: number
  noTable: number
  ambiguous: number
  conflict: number
  /** Polygons and unreadable outlines. */
  skipped: number
  /** Mean distancePx over moves; 0 when nothing moves. */
  avgMovePx: number
  linkMismatches: number
}

export interface RealignPlan {
  results: RealignResult[]
  summary: RealignSummaryCounts
}

function area(b: Box): number {
  return Math.max(0, b.maxX - b.minX) * Math.max(0, b.maxY - b.minY)
}

function intersection(a: Box, b: Box): number {
  const w = Math.min(a.maxX, b.maxX) - Math.max(a.minX, b.minX)
  const h = Math.min(a.maxY, b.maxY) - Math.max(a.minY, b.minY)
  return w > 0 && h > 0 ? w * h : 0
}

function edgeDistance(a: Box, b: Box): number {
  return Math.max(Math.abs(a.minX - b.minX), Math.abs(a.minY - b.minY), Math.abs(a.maxX - b.maxX), Math.abs(a.maxY - b.maxY))
}

function isRect(s: RealignShape): boolean {
  return s.shape === 'rect' && s.points.length === 8 && s.points.every((v) => Number.isFinite(v))
}

export function planRealignment(
  existing: readonly RealignShape[],
  detected: readonly RealignDetected[],
  nodes: readonly MatchableNode[],
): RealignPlan {
  const R = REALIGN_RULES
  const targets = detected.map((d, i) => ({ d, i })).filter((t) => t.d.snapped && area(t.d.box) > 0)
  const rects = existing.filter(isRect)
  const skipped = existing.length - rects.length

  // 1. Each shape's best table.
  type Pick = { shape: RealignShape; box: Box; table: number | null; iou: number; ambiguous: boolean }
  const picks: Pick[] = rects.map((shape) => {
    const box = boundingBox(shape.points)
    const a = area(box)
    const scored = targets
      .map((t) => {
        const inter = intersection(box, t.d.box)
        const smaller = Math.min(a, area(t.d.box))
        return { i: t.i, ratio: smaller > 0 ? inter / smaller : 0, iou: inter / (a + area(t.d.box) - inter) }
      })
      .filter((s) => s.ratio >= R.minOverlap)
      .sort((x, y) => y.ratio - x.ratio)
    if (scored.length === 0) return { shape, box, table: null, iou: 0, ambiguous: false }
    const [best, second] = scored
    if (second && second.ratio >= R.runnerUp * best!.ratio) return { shape, box, table: null, iou: 0, ambiguous: true }
    return { shape, box, table: best!.i, iou: best!.iou, ambiguous: false }
  })

  // 2. One shape per table: the highest IoU wins; a tie leaves them all.
  const winner = new Map<number, string | null>()
  for (const t of new Set(picks.flatMap((p) => (p.table === null ? [] : [p.table])))) {
    const claim = picks.filter((p) => p.table === t).sort((x, y) => y.iou - x.iou)
    const tie = claim.length > 1 && claim[0]!.iou === claim[1]!.iou
    winner.set(t, tie ? null : claim[0]!.shape.id)
  }

  // 3. Results, with the link check on every paired shape.
  const index = buildNodeIndex(nodes)
  const results: RealignResult[] = picks.map((p): RealignResult => {
    const base = { shapeId: p.shape.id, nodeId: p.shape.nodeId }
    if (p.ambiguous) return { ...base, kind: 'ambiguous' }
    if (p.table === null) return { ...base, kind: 'no_table' }
    if (winner.get(p.table) !== p.shape.id) return { ...base, kind: 'conflict' }
    const d = detected[p.table]!
    const m = matchBlock({ tag: d.tag, name: d.name ?? null }, index)
    const linkMismatch = m.state === 'matched' && m.nodeId !== p.shape.nodeId && d.tag
      ? { tableTag: d.tag, suggestedNodeId: m.nodeId }
      : undefined
    const paired = { ...base, tableIndex: p.table, ...(linkMismatch ? { linkMismatch } : {}) }
    const distancePx = edgeDistance(p.box, d.box)
    if (distancePx <= R.alignedPx) return { ...paired, kind: 'unchanged' }
    return {
      ...paired,
      kind: 'move',
      from: [...p.shape.points],
      to: rectToPoints(d.box.minX, d.box.minY, d.box.maxX, d.box.maxY),
      distancePx,
      expectedUpdatedAt: p.shape.updatedAt,
    }
  })

  const count = (k: RealignResult['kind']) => results.filter((r) => r.kind === k).length
  const moves = results.flatMap((r) => (r.kind === 'move' ? [r.distancePx] : []))
  return {
    results,
    summary: {
      move: moves.length,
      unchanged: count('unchanged'),
      noTable: count('no_table'),
      ambiguous: count('ambiguous'),
      conflict: count('conflict'),
      skipped,
      avgMovePx: moves.length ? moves.reduce((s, v) => s + v, 0) / moves.length : 0,
      linkMismatches: results.filter((r) => r.linkMismatch).length,
    },
  }
}

/** "N will snap to their table (avg X px) · U already aligned · L left as they are". */
export function realignSummary(s: RealignSummaryCounts): string {
  const left = s.noTable + s.ambiguous + s.conflict + s.skipped
  return `${s.move} will snap to their table (avg ${Math.round(s.avgMovePx)} px) · ${s.unchanged} already aligned · ${left} left as they are`
}
