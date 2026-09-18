/**
 * Undo/redo for route mode — a history of SNAPSHOTS.
 *
 * A snapshot is everything the measurer can see change: the saved legs as the
 * server holds them (points only — ids are the server's business), the pending
 * leg, and the polyline being clicked out. Undoing a persisted edit means
 * "persist the previous snapshot's legs": the save action replaces the whole
 * segment list, so there is no inverse operation to get wrong.
 *
 * Pure. The canvas owns the state; this module owns the rules.
 */

export interface SnapshotLeg {
  floorPlanId: string
  pageIndex: number
  points: number[]
}

export interface RouteSnapshot {
  legs: SnapshotLeg[]
  pending: number[] | null
  draft: number[]
}

export interface RouteHistory {
  past: RouteSnapshot[]
  present: RouteSnapshot
  future: RouteSnapshot[]
  canUndo: boolean
  canRedo: boolean
}

/** A long session must not grow without bound; 100 steps is more than any leg needs. */
const LIMIT = 100

function legKey(l: SnapshotLeg): string {
  return `${l.floorPlanId}#${l.pageIndex}#${l.points.join(',')}`
}

export function snapshotsEqual(a: RouteSnapshot, b: RouteSnapshot): boolean {
  if (a.legs.length !== b.legs.length) return false
  for (let i = 0; i < a.legs.length; i++) if (legKey(a.legs[i]) !== legKey(b.legs[i])) return false
  const pa = a.pending ? a.pending.join(',') : ''
  const pb = b.pending ? b.pending.join(',') : ''
  return pa === pb && a.draft.join(',') === b.draft.join(',')
}

function build(past: RouteSnapshot[], present: RouteSnapshot, future: RouteSnapshot[]): RouteHistory {
  return { past, present, future, canUndo: past.length > 0, canRedo: future.length > 0 }
}

export function emptyHistory(present: RouteSnapshot): RouteHistory {
  return build([], present, [])
}

/** Record a new present. A no-change push is ignored; any redo branch is discarded. */
export function pushHistory(h: RouteHistory, next: RouteSnapshot): RouteHistory {
  if (snapshotsEqual(h.present, next)) return h
  const past = [...h.past, h.present]
  return build(past.length > LIMIT ? past.slice(past.length - LIMIT) : past, next, [])
}

export function undoHistory(h: RouteHistory): RouteHistory {
  if (h.past.length === 0) return h
  const prev = h.past[h.past.length - 1]
  return build(h.past.slice(0, -1), prev, [h.present, ...h.future])
}

export function redoHistory(h: RouteHistory): RouteHistory {
  if (h.future.length === 0) return h
  const [next, ...rest] = h.future
  return build([...h.past, h.present], next, rest)
}
