/**
 * The status-plan canvas's interaction rules, without Konva or a DOM.
 *
 * The component turns pointer and key input into events in IMAGE space and
 * applies the returned state; a `commit` is a finished shape for the caller
 * to save. Tolerances arrive in image pixels (the component divides a screen
 * distance by the zoom), so the rules hold at any zoom.
 */
import { dedupeConsecutivePoints } from '@esite/shared'
import { roundPoints } from './canvas-shape'
import { pointsError, rectToPoints } from '@esite/shared/status-plans'

export type CanvasTool = 'select' | 'polygon' | 'rect' | 'pan' | 'calibrate'

export interface CanvasState {
  tool: CanvasTool
  /** Polygon corners placed so far, flat. */
  draft: number[]
  /** Rectangle being dragged. */
  rect: { x0: number; y0: number; x1: number; y1: number } | null
  /** Calibration points, flat, at most two. */
  calib: number[]
}

export interface ShapeCommit {
  shape: 'polygon' | 'rect'
  points: number[]
}

export type CanvasEvent =
  | { type: 'tool'; tool: CanvasTool }
  | { type: 'press'; x: number; y: number; tolPx: number }
  | { type: 'move'; x: number; y: number }
  | { type: 'release'; x: number; y: number; tolPx: number }
  | { type: 'finish'; tolPx: number }
  | { type: 'escape' }
  | { type: 'undoPoint' }

export interface CanvasStep {
  state: CanvasState
  commit: ShapeCommit | null
  /** A sentence for the person when a finished shape was refused client-side; the draft is kept. */
  error?: string | null
}

export function initialCanvasState(tool: CanvasTool = 'select'): CanvasState {
  return { tool, draft: [], rect: null, calib: [] }
}

/** Nothing in progress: Escape should fall through to "deselect". */
export function isIdle(s: CanvasState): boolean {
  return s.draft.length === 0 && s.rect === null && s.calib.length === 0
}

/**
 * The polygon a draft becomes, or null when it has fewer than 3 corners. A
 * double-click stamps extra presses on the last corner, and a press on the
 * first corner is the close gesture, not a corner: both are removed.
 */
function closePolygon(draft: number[], tolPx: number): number[] | null {
  let pts = dedupeConsecutivePoints(draft, tolPx)
  const n = pts.length
  if (n >= 8 && Math.hypot(pts[0]! - pts[n - 2]!, pts[1]! - pts[n - 1]!) <= tolPx) pts = pts.slice(0, -2)
  return pts.length >= 6 ? pts : null
}

const same = (state: CanvasState): CanvasStep => ({ state, commit: null, error: null })

/**
 * Finish a polygon draft: commit it, or keep every vertex and say why not.
 * The server would refuse the same shape, but only after the draft was gone.
 */
function finishPolygon(s: CanvasState, tolPx: number): CanvasStep {
  const pts = closePolygon(s.draft, tolPx)
  if (!pts) return { state: { ...s, draft: [] }, commit: null, error: null }
  const err = pointsError('polygon', roundPoints(pts))
  if (err) return { state: s, commit: null, error: err }
  return { state: { ...s, draft: [] }, commit: { shape: 'polygon', points: pts }, error: null }
}

export function canvasReducer(s: CanvasState, e: CanvasEvent): CanvasStep {
  switch (e.type) {
    case 'tool':
      return same(initialCanvasState(e.tool))

    case 'press': {
      if (s.tool === 'polygon') {
        const n = s.draft.length
        if (n >= 6 && Math.hypot(e.x - s.draft[0]!, e.y - s.draft[1]!) <= e.tolPx) {
          return finishPolygon(s, e.tolPx)
        }
        return same({ ...s, draft: [...s.draft, e.x, e.y] })
      }
      if (s.tool === 'rect') return same({ ...s, rect: { x0: e.x, y0: e.y, x1: e.x, y1: e.y } })
      if (s.tool === 'calibrate') return same({ ...s, calib: s.calib.length < 4 ? [...s.calib, e.x, e.y] : [e.x, e.y] })
      return same(s)
    }

    case 'move':
      if (!s.rect) return same(s)
      return same({ ...s, rect: { ...s.rect, x1: e.x, y1: e.y } })

    case 'release': {
      if (!s.rect) return same(s)
      const { x0, y0 } = s.rect
      const next = { ...s, rect: null }
      if (Math.abs(e.x - x0) < e.tolPx || Math.abs(e.y - y0) < e.tolPx) return same(next)
      return { state: next, commit: { shape: 'rect', points: rectToPoints(x0, y0, e.x, e.y) }, error: null }
    }

    case 'finish': {
      if (s.tool !== 'polygon' || s.draft.length === 0) return same(s)
      return finishPolygon(s, e.tolPx)
    }

    case 'escape':
      if (s.draft.length) return same({ ...s, draft: [] })
      if (s.rect) return same({ ...s, rect: null })
      if (s.calib.length) return same({ ...s, calib: [] })
      return same(s)

    case 'undoPoint':
      return s.draft.length ? same({ ...s, draft: s.draft.slice(0, -2) }) : same(s)
  }
}

/**
 * A shape's points after dragging vertex `index` to (x, y). A rectangle stays
 * axis-aligned: the opposite corner is the anchor and the four corners are
 * re-derived, so a drag can never store a rect the CHECK would refuse.
 */
export function dragVertex(shape: { shape: 'polygon' | 'rect'; points: readonly number[] }, index: number, x: number, y: number): number[] {
  if (shape.shape === 'rect') {
    const o = (index + 2) % 4
    return rectToPoints(shape.points[o * 2]!, shape.points[o * 2 + 1]!, x, y)
  }
  const out = shape.points.slice()
  out[index * 2] = x
  out[index * 2 + 1] = y
  return out
}
