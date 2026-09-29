/**
 * Undo/redo for the layout canvas — a history of SNAPSHOTS of the object list
 * (the lib/cable-route/route-history.ts pattern). One drag, one placed array or
 * one property edit is one step (functional spec §6.3). Pure.
 */
export interface History<T> {
  past: T[]
  present: T
  future: T[]
  canUndo: boolean
  canRedo: boolean
}

export const HISTORY_LIMIT = 100

function build<T>(past: T[], present: T, future: T[]): History<T> {
  return { past, present, future, canUndo: past.length > 0, canRedo: future.length > 0 }
}

export function emptyHistory<T>(present: T): History<T> {
  return build([], present, [])
}

export function pushHistory<T>(h: History<T>, next: T): History<T> {
  if (JSON.stringify(h.present) === JSON.stringify(next)) return h
  const past = [...h.past, h.present]
  return build(past.length > HISTORY_LIMIT ? past.slice(past.length - HISTORY_LIMIT) : past, next, [])
}

export function undoHistory<T>(h: History<T>): History<T> {
  if (h.past.length === 0) return h
  return build(h.past.slice(0, -1), h.past[h.past.length - 1]!, [h.present, ...h.future])
}

export function redoHistory<T>(h: History<T>): History<T> {
  if (h.future.length === 0) return h
  const [next, ...rest] = h.future
  return build([...h.past, h.present], next!, rest)
}
