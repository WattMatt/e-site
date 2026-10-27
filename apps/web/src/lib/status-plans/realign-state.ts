/**
 * "Re-align blocks to the drawing" — the scan, preview, apply and undo steps
 * as a pure reducer (RealignBlocksPanel drives it; Konva only draws what
 * realignProposals returns, so the canvas needs no state of its own).
 *
 *   idle ──scan──▶ scanning ──scanned(plan)──▶ preview ──apply──▶ applying
 *     ▲               │ no lines / no tables / error            │
 *     └───────────────┘◀──cancel── preview      applied ◀────────┘
 *   applied ──undo──▶ undoing ──undone──▶ idle (or back to applied on a refusal)
 *
 * Every scan bumps `run`; a scan answer for any other run, or one arriving
 * when the reducer is no longer scanning (cancelled, sheet changed), is
 * dropped — the DetectBlocksPanel run-id rule as data.
 * A refused apply ends the preview: the plan was made against shapes that
 * have since changed, so applying it again could only be refused again.
 */
import {
  buildLineIndex,
  detectBlocks,
  planRealignment,
  snapBlocks,
  type ImageTextItem,
  type LineSegment,
  type MatchableNode,
  type RealignPlan,
} from '@esite/shared/status-plans'
import type { CanvasShape } from './types'

export interface RealignMove {
  shapeId: string
  expectedUpdatedAt: string
  points: number[]
}

export type RealignScan =
  | { kind: 'plan'; plan: RealignPlan }
  | { kind: 'no_lines' }
  | { kind: 'no_tables' }
  | { kind: 'error'; message: string }

export type RealignState =
  | { phase: 'idle'; run: number; message: string | null }
  | { phase: 'scanning'; run: number }
  | { phase: 'preview' | 'applying'; run: number; plan: RealignPlan; moves: RealignMove[]; before: Record<string, number[]>; message: string | null }
  | { phase: 'applied' | 'undoing'; run: number; count: number; undo: RealignMove[]; message: string | null }

export type RealignEvent =
  | { type: 'scan' }
  | { type: 'scanned'; run: number; scan: RealignScan }
  | { type: 'cancel' }
  | { type: 'apply' }
  | { type: 'applied'; shapes: CanvasShape[] }
  | { type: 'applyFailed'; error: string }
  | { type: 'undo' }
  | { type: 'undone' }
  | { type: 'undoFailed'; error: string }

export const initialRealignState: RealignState = { phase: 'idle', run: 0, message: null }

export const NO_LINES = 'This drawing has no table lines to align to.'
export const NO_TABLES = 'No table borders were found round any DB block on this drawing.'

export function realignReducer(s: RealignState, e: RealignEvent): RealignState {
  switch (e.type) {
    case 'scan':
      if (s.phase === 'applying' || s.phase === 'undoing' || s.phase === 'scanning') return s
      return { phase: 'scanning', run: s.run + 1 }
    case 'scanned': {
      if (s.phase !== 'scanning' || e.run !== s.run) return s
      const scan = e.scan
      if (scan.kind === 'no_lines') return { phase: 'idle', run: s.run, message: NO_LINES }
      if (scan.kind === 'no_tables') return { phase: 'idle', run: s.run, message: NO_TABLES }
      if (scan.kind === 'error') return { phase: 'idle', run: s.run, message: scan.message }
      const moves: RealignMove[] = []
      const before: Record<string, number[]> = {}
      for (const r of scan.plan.results) {
        if (r.kind !== 'move') continue
        moves.push({ shapeId: r.shapeId, expectedUpdatedAt: r.expectedUpdatedAt, points: r.to })
        before[r.shapeId] = r.from
      }
      return { phase: 'preview', run: s.run, plan: scan.plan, moves, before, message: null }
    }
    case 'cancel':
      if (s.phase !== 'preview' && s.phase !== 'scanning') return s
      return { phase: 'idle', run: s.run, message: null }
    case 'apply':
      if (s.phase !== 'preview' || s.moves.length === 0) return s
      return { ...s, phase: 'applying', message: null }
    case 'applied': {
      if (s.phase !== 'applying') return s
      const undo = e.shapes.flatMap((sh) => (s.before[sh.id] ? [{ shapeId: sh.id, expectedUpdatedAt: sh.updatedAt, points: s.before[sh.id]! }] : []))
      return { phase: 'applied', run: s.run, count: e.shapes.length, undo, message: null }
    }
    case 'applyFailed':
      if (s.phase !== 'applying') return s
      return { phase: 'idle', run: s.run, message: e.error }
    case 'undo':
      if (s.phase !== 'applied' || s.undo.length === 0) return s
      return { ...s, phase: 'undoing', message: null }
    case 'undone':
      if (s.phase !== 'undoing') return s
      return { phase: 'idle', run: s.run, message: `Put ${s.count} ${s.count === 1 ? 'block' : 'blocks'} back where ${s.count === 1 ? 'it was' : 'they were'}.` }
    case 'undoFailed':
      if (s.phase !== 'undoing') return s
      return { ...s, phase: 'applied', message: e.error }
  }
}

/** The outlines the canvas draws dashed while a preview is open. */
export function realignProposals(s: RealignState): number[][] {
  return s.phase === 'preview' || s.phase === 'applying' ? s.moves.map((m) => m.points) : []
}

/** Read the sheet's tables and plan the moves (the same detect + snap as Scan sheet). */
export function scanForRealign(
  page: { items: readonly ImageTextItem[]; rawItemCount: number; lines: readonly LineSegment[] },
  shapes: readonly CanvasShape[],
  nodes: readonly MatchableNode[],
): RealignScan {
  const index = buildLineIndex(page.lines)
  if (index.count === 0) return { kind: 'no_lines' }
  const blocks = snapBlocks(detectBlocks(page.items).blocks, index).filter((b) => b.snapped)
  if (blocks.length === 0) return { kind: 'no_tables' }
  const plan = planRealignment(
    shapes.map((s) => ({ id: s.id, shape: s.shape, points: s.invalidReason ? [] : s.points, nodeId: s.nodeId, updatedAt: s.updatedAt })),
    blocks,
    nodes,
  )
  return { kind: 'plan', plan }
}
