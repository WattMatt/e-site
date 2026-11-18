/**
 * The programme screen's client state: optimistic preview, serial save pipeline,
 * key → id reconciliation, undo/redo and stale handling.
 *
 * `createProgrammeStore` is a plain external store (no React) so the pipeline can be
 * tested with an injected `save`; `useProgrammeStore` wraps it for the screen.
 *
 * - A gesture's ops are applied locally with `applyOps` (the twin of save_changes) and
 *   scheduled with the engine. A refusal from either is shown and nothing is saved.
 * - Keys for new rows come from the store (`newKey`). A gesture that reuses a key still
 *   previewed as `key:<k>` is refused, so two rows can never share a preview id.
 * - Saves are serial: the next gesture's ops go only after the previous save answered,
 *   with the version that save returned.
 * - New rows are previewed under `key:<k>`. A save answers `ids: { k: uuid }`; every
 *   `key:<k>` is then rewritten to the uuid in the state, the undo/redo snapshots and the
 *   still-queued gestures (their ops and rollback snapshots). Shared objects are rewritten
 *   once, so snapshots that shared rows keep sharing them.
 * - The stale refusal (40001) keeps the preview, marked unsaved, and blocks further edits
 *   until a reload. Any other refusal rolls back to before that gesture and drops whatever
 *   was queued on top of it (and says how many later changes were not saved).
 * - Undo/redo save `diffToOps(current, target)` as an ordinary gesture.
 * - Versions (`programmes.updated_at`) are compared as instants, never as text. A version
 *   that does not parse is "unknown" and never makes the screen stale.
 */
import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import { useRouter } from 'next/navigation'
import {
  applyOps, diffToOps, ProgrammeOpError, rowsToProgrammeInput, scheduleProgramme,
  type ProgrammeOp, type ProgrammeState, type ScheduleResult,
} from '@esite/shared/programme'
import { programmeVersionAction, saveProgrammeChangesAction } from '@/actions/programme.actions'
import { PROGRAMME_STALE, type SaveProgrammeChangesInput, type SaveProgrammeResult } from '@/lib/programme/action-types'
import type { ProgrammeViewData } from '@/lib/programme/view-types'

export const UNDO_DEPTH = 100
export const UNDO_GONE = 'This change can no longer be undone. Reload to see the current programme.'
export const KEY_REUSED = 'Each new row needs its own key.'
const SAVE_FAILED = 'The programme could not be saved. Try again.'
const PREVIEW_FAILED = 'That change could not be applied.'
const POLL_MS = 30_000

export type SaveFn = (input: SaveProgrammeChangesInput) => Promise<SaveProgrammeResult>

/**
 * The undo depth for a programme of `activities` rows: every entry holds two full state
 * copies, so a large programme keeps fewer (100 at most, 10 at least).
 */
export function undoDepthFor(activities: number): number {
  if (activities <= 0) return UNDO_DEPTH
  return Math.min(UNDO_DEPTH, Math.max(10, Math.floor(200_000 / activities)))
}

/**
 * A version as an instant (ms since the epoch), or null when it does not parse.
 * `Date.parse` keeps milliseconds only; the database keeps microseconds, so two versions
 * inside the same millisecond compare equal. That is accepted: it can only hide a change
 * made within one millisecond of this client's own save.
 */
function instant(v: string): number | null {
  const t = Date.parse(v)
  return Number.isNaN(t) ? null : t
}

interface Entry { before: ProgrammeState; after: ProgrammeState; label: string }
interface Gesture { ops: ProgrammeOp[]; kind: 'apply' | 'undo' | 'redo'; rollback: { state: ProgrammeState; undo: Entry[]; redo: Entry[] } }

interface Internal {
  state: ProgrammeState
  /** The last state the server confirmed (equal to `state` when nothing is unsaved). */
  saved: ProgrammeState
  version: string
  undo: Entry[]
  redo: Entry[]
  queue: Gesture[]
  sending: boolean
  stale: boolean
  error: string | null
  offerReload: boolean
}

export interface ProgrammeStoreSnapshot {
  state: ProgrammeState
  version: string
  /** A gesture is queued or its save is in flight. */
  pending: boolean
  /** Someone else changed the programme; edits are blocked until a reload. */
  stale: boolean
  /** The preview shows changes the server does not hold. */
  unsaved: boolean
  error: string | null
  /** The error is one only a reload can clear. */
  offerReload: boolean
  canUndo: boolean
  canRedo: boolean
  undoLabel: string | null
  redoLabel: string | null
  /**
   * Every `key:<k>` preview id rewritten so far on this page, to its saved uuid. Views
   * holding ids of their own (selection, an open editor) resolve them through it, so a
   * row's save landing mid-gesture does not lose it.
   */
  keyIds: Readonly<Record<string, string>>
}

// ── id rewriting ────────────────────────────────────────────────────────────

/** Field names that hold a row reference, in state rows and in ops. */
const ID_FIELDS = new Set([
  'id', 'parent_id', 'pred_id', 'succ_id', 'calendar_id', 'default_calendar_id', 'activity_id', 'code_type_id', 'code_value_id',
  'pred', 'succ', 'activity', 'calendar', 'code_type', 'code_value',
])

/**
 * Rewrites every reference found in `map` (`key:<k>` → uuid). Only id-bearing fields and
 * the `*Ids` string arrays are touched, never a name or an op's own `key`. Objects that
 * hold nothing to rewrite are returned as they are; an object reached twice (through
 * `memo`, which callers share across one save) is rewritten once, so sharing survives.
 */
export function rewriteIds<T>(value: T, map: Readonly<Record<string, string>>, memo: WeakMap<object, unknown> = new WeakMap()): T {
  const walk = (v: unknown, field: string | null): unknown => {
    if (typeof v === 'string') {
      const idish = field !== null && (ID_FIELDS.has(field) || field.endsWith('Ids'))
      return idish && Object.prototype.hasOwnProperty.call(map, v) ? map[v] : v
    }
    if (v === null || typeof v !== 'object') return v
    if (Array.isArray(v)) {
      // A string array's result depends on its field, so only arrays of objects are memoised.
      const memoable = !v.some((x) => typeof x === 'string')
      if (memoable && memo.has(v)) return memo.get(v)
      let changed = false
      const out = v.map((x) => { const y = walk(x, typeof x === 'string' ? field : null); if (y !== x) changed = true; return y })
      const result = changed ? out : v
      if (memoable) memo.set(v, result)
      return result
    }
    if (memo.has(v)) return memo.get(v)
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [k, x] of Object.entries(v as Record<string, unknown>)) {
      const y = walk(x, k)
      if (y !== x) changed = true
      out[k] = y
    }
    const result = changed ? out : v
    memo.set(v, result)
    return result
  }
  return walk(value, null) as T
}

// ── schedule cache ──────────────────────────────────────────────────────────

/** One slot: the engine result of the most recent state asked about. History is never cached. */
let lastSchedule: { state: ProgrammeState; result: ScheduleResult } | null = null
/** The engine's result for a state; the latest state's result is reused. */
export function scheduleFor(state: ProgrammeState): ScheduleResult {
  if (lastSchedule?.state === state) return lastSchedule.result
  const result = scheduleProgramme(rowsToProgrammeInput(state))
  lastSchedule = { state, result }
  return result
}

/** applyOps then the engine. A refusal is a sentence; nothing is thrown. */
function preview(state: ProgrammeState, ops: ProgrammeOp[]): { ok: true; next: ProgrammeState } | { ok: false; error: string; opError: boolean } {
  let next: ProgrammeState
  try {
    next = applyOps(state, ops)
  } catch (e) {
    return { ok: false, error: e instanceof ProgrammeOpError ? e.message : PREVIEW_FAILED, opError: true }
  }
  const sched = scheduleFor(next)
  if (!sched.ok) {
    const first = sched.issues.find((i) => i.severity === 'error')
    return { ok: false, error: first?.message ?? 'The programme could not be scheduled.', opError: false }
  }
  return { ok: true, next }
}

/** Keys unique across this page load: `n<counter>-<random>` (the server needs them unique per save only). */
function defaultNewKey(): () => string {
  const suffix = Math.random().toString(36).slice(2, 8) || 'x'
  let n = 0
  return () => `n${++n}-${suffix}`
}

/** True when an op creates a row under a key whose `key:<k>` id is still in the state. */
function reusesKey(state: ProgrammeState, ops: ProgrammeOp[]): boolean {
  const keys = ops.map((o) => (o as { key?: unknown }).key).filter((k): k is string => typeof k === 'string')
  if (keys.length === 0) return false
  const ids = new Set<string>()
  for (const rows of [state.activities, state.dependencies, state.calendars, state.codeTypes, state.codeValues]) {
    for (const r of rows as Array<{ id: string }>) if (r.id.startsWith('key:')) ids.add(r.id)
  }
  return keys.some((k) => ids.has(`key:${k}`))
}

const laterNotSaved = (n: number) => (n === 1 ? '1 later change was not saved.' : `${n} later changes were not saved.`)

// ── the store ───────────────────────────────────────────────────────────────

export interface ProgrammeStore {
  getSnapshot(): ProgrammeStoreSnapshot
  subscribe(listener: () => void): () => void
  /** A fresh key for a new row in a gesture. */
  newKey(): string
  /**
   * Re-runs the schedule on the server: a gesture with no ops, so it waits for earlier saves, later
   * edits wait for it, and the version it returns becomes the store's. False when read-only or stale.
   */
  recalculate(): boolean
  /** Previews and queues a gesture. False when nothing was applied (read-only, stale, refused, empty). */
  apply(ops: ProgrammeOp[], label: string): boolean
  undo(): void
  redo(): void
  setCanEdit(canEdit: boolean): void
  /** Count of completed saves; a poll records it when issued and passes it back with the answer. */
  saveSeq(): number
  /**
   * The poll's answer: marks the screen stale when the server version is a strictly later
   * instant and nothing is pending. An answer issued before the latest save completed
   * (`seq` differs) is dropped.
   */
  noteServerVersion(version: string, seq?: number): void
  /** Takes a fresh server view when nothing is pending. True when it was taken. */
  resetFrom(view: ProgrammeViewData): boolean
  /** Reload was pressed: the next offered view is taken whatever its version. */
  requestReset(): void
  /** A view handed down by the page: taken when a reset was requested or it is newer. */
  offerView(view: ProgrammeViewData): boolean
  clearError(): void
  /**
   * Resolves once nothing is queued or sending. `ok` is false when the screen still holds
   * changes the server has not confirmed (a refusal rolled them back, or the stale refusal
   * kept them unsaved); `error` is the sentence shown.
   */
  settle(): Promise<SettleResult>
}

export interface SettleResult { ok: boolean; error: string | null }

export function createProgrammeStore(
  view: ProgrammeViewData,
  opts: { canEdit: boolean; save: SaveFn; newKey?: () => string },
): ProgrammeStore {
  const newKey = opts.newKey ?? defaultNewKey()
  let canEdit = opts.canEdit
  let keyIds: Readonly<Record<string, string>> = {}
  let s: Internal = fresh(view)
  let snap = toSnapshot(s)
  let seq = 0
  let resetRequested = false
  const listeners = new Set<() => void>()

  function fresh(v: ProgrammeViewData): Internal {
    return {
      state: v.state, saved: v.state, version: v.version, undo: [], redo: [], queue: [],
      sending: false, stale: false, error: null, offerReload: false,
    }
  }
  function toSnapshot(i: Internal): ProgrammeStoreSnapshot {
    return {
      state: i.state, version: i.version, pending: i.queue.length > 0, stale: i.stale,
      unsaved: i.state !== i.saved, error: i.error, offerReload: i.offerReload,
      canUndo: canEdit && !i.stale && i.undo.length > 0, canRedo: canEdit && !i.stale && i.redo.length > 0,
      undoLabel: i.undo.at(-1)?.label ?? null, redoLabel: i.redo.at(-1)?.label ?? null,
      keyIds,
    }
  }
  function set(next: Internal): void {
    s = next
    snap = toSnapshot(s)
    for (const l of listeners) l()
  }
  const editable = () => canEdit && !s.stale
  const idle = () => s.queue.length === 0 && !s.sending

  function enqueue(kind: Gesture['kind'], ops: ProgrammeOp[], next: ProgrammeState, undo: Entry[], redo: Entry[]): void {
    const gesture: Gesture = { ops, kind, rollback: { state: s.state, undo: s.undo, redo: s.redo } }
    set({ ...s, state: next, undo, redo, queue: [...s.queue, gesture], error: null, offerReload: false })
    void pump()
  }

  async function pump(): Promise<void> {
    if (s.sending || s.stale || s.queue.length === 0) return
    const head = s.queue[0]
    s = { ...s, sending: true }
    let r: SaveProgrammeResult
    try {
      r = await opts.save({ programmeId: s.state.programme.id, expectedVersion: s.version, ops: head.ops })
    } catch {
      r = { ok: false, error: SAVE_FAILED }
    }
    if (r.ok) {
      seq += 1
      const map: Record<string, string> = {}
      for (const [k, id] of Object.entries(r.ids ?? {})) map[`key:${k}`] = id
      if (Object.keys(map).length > 0) keyIds = { ...keyIds, ...map }
      const memo = new WeakMap<object, unknown>()
      const rw = <T>(v: T): T => (Object.keys(map).length > 0 ? rewriteIds(v, map, memo) : v)
      const rest = rw(s.queue.slice(1))
      const state = rw(s.state)
      // Everything queued on top of this gesture is still unsaved; when nothing is, the preview IS the server state.
      const savedState = rest.length === 0 ? state : rest[0].rollback.state
      set({
        ...s, sending: false, version: r.version, state, saved: savedState,
        undo: rw(s.undo), redo: rw(s.redo), queue: rest,
      })
      void pump()
      return
    }
    if (r.error === PROGRAMME_STALE) {
      set({ ...s, sending: false, stale: true, queue: [], error: null, offerReload: false })
      return
    }
    const back = head.rollback
    const dropped = s.queue.length - 1
    const error = dropped > 0 ? `${r.error} ${laterNotSaved(dropped)}` : r.error
    set({
      ...s, sending: false, state: back.state, undo: back.undo, redo: back.redo, queue: [],
      error, offerReload: head.kind !== 'apply',
    })
  }

  function step(direction: 'undo' | 'redo'): void {
    if (!editable()) return
    const from = direction === 'undo' ? s.undo : s.redo
    const entry = from.at(-1)
    if (!entry) return
    const target = direction === 'undo' ? entry.before : entry.after
    let ops: ProgrammeOp[]
    try {
      ops = diffToOps(s.state, target, newKey)
    } catch {
      set({ ...s, error: UNDO_GONE, offerReload: true })
      return
    }
    const rest = from.slice(0, -1)
    const undo = direction === 'undo' ? rest : [...s.undo, entry]
    const redo = direction === 'undo' ? [...s.redo, entry] : rest
    if (ops.length === 0) {
      set({ ...s, undo, redo, error: null, offerReload: false })
      return
    }
    const p = preview(s.state, ops)
    if (!p.ok) {
      set({ ...s, error: p.opError ? UNDO_GONE : p.error, offerReload: p.opError })
      return
    }
    enqueue(direction, ops, p.next, undo, redo)
  }

  function take(v: ProgrammeViewData): boolean {
    if (!idle()) return false
    resetRequested = false
    set(fresh(v))
    return true
  }

  return {
    getSnapshot: () => snap,
    subscribe(listener) {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    newKey,
    apply(ops, label) {
      if (!editable() || ops.length === 0) return false
      if (reusesKey(s.state, ops)) {
        set({ ...s, error: KEY_REUSED, offerReload: false })
        return false
      }
      const p = preview(s.state, ops)
      if (!p.ok) {
        set({ ...s, error: p.error, offerReload: false })
        return false
      }
      const depth = undoDepthFor(p.next.activities.length)
      const undo = [...s.undo, { before: s.state, after: p.next, label }].slice(-depth)
      enqueue('apply', ops, p.next, undo, [])
      return true
    },
    recalculate() {
      if (!editable()) return false
      enqueue('apply', [], s.state, s.undo, s.redo)
      return true
    },
    undo: () => step('undo'),
    redo: () => step('redo'),
    setCanEdit(next) {
      if (next === canEdit) return
      canEdit = next
      set({ ...s })
    },
    saveSeq: () => seq,
    noteServerVersion(version, issuedAt) {
      if (issuedAt !== undefined && issuedAt !== seq) return
      if (!idle() || s.stale) return
      const server = instant(version)
      const local = instant(s.version)
      if (server === null || local === null || server <= local) return
      set({ ...s, stale: true })
    },
    resetFrom: take,
    requestReset() { resetRequested = true },
    offerView(v) {
      if (resetRequested) return take(v)
      const server = instant(v.version)
      const local = instant(s.version)
      const newer = server !== null && local !== null ? server > local : v.version !== s.version
      return newer ? take(v) : false
    },
    clearError() {
      if (s.error !== null) set({ ...s, error: null, offerReload: false })
    },
    settle() {
      const result = (): SettleResult => {
        if (s.stale) return { ok: false, error: PROGRAMME_STALE }
        if (s.error !== null) return { ok: false, error: s.error }
        return { ok: s.state === s.saved, error: s.state === s.saved ? null : SAVE_FAILED }
      }
      if (idle()) return Promise.resolve(result())
      return new Promise<SettleResult>((resolve) => {
        const listener = () => {
          if (!idle()) return
          listeners.delete(listener)
          resolve(result())
        }
        listeners.add(listener)
      })
    },
  }
}

// ── the hook ────────────────────────────────────────────────────────────────

export interface ProgrammeStoreApi extends ProgrammeStoreSnapshot {
  schedule: ScheduleResult
  newKey(): string
  apply(ops: ProgrammeOp[], label: string): boolean
  recalculate(): boolean
  undo(): void
  redo(): void
  reload(): void
  clearError(): void
  settle(): Promise<SettleResult>
}

export function useProgrammeStore(initial: ProgrammeViewData, opts: { canEdit: boolean }): ProgrammeStoreApi {
  const router = useRouter()
  const [store] = useState(() => createProgrammeStore(initial, { canEdit: opts.canEdit, save: saveProgrammeChangesAction }))
  const snap = useSyncExternalStore(store.subscribe, store.getSnapshot, store.getSnapshot)

  useEffect(() => { store.setCanEdit(opts.canEdit) }, [store, opts.canEdit])

  // A refresh hands a new view object: take it when Reload asked for one, or when it is newer.
  useEffect(() => { store.offerView(initial) }, [store, initial])

  const programmeId = snap.state.programme.id
  useEffect(() => {
    const timer = setInterval(() => {
      if (typeof document !== 'undefined' && document.visibilityState !== 'visible') return
      if (store.getSnapshot().pending) return
      const issuedAt = store.saveSeq()
      void programmeVersionAction({ programmeId }).then((r) => { if (r.ok) store.noteServerVersion(r.version, issuedAt) }, () => {})
    }, POLL_MS)
    return () => clearInterval(timer)
  }, [store, programmeId])

  const schedule = useMemo(() => scheduleFor(snap.state), [snap.state])
  return {
    ...snap, schedule, newKey: store.newKey,
    apply: store.apply, recalculate: store.recalculate, undo: store.undo, redo: store.redo, clearError: store.clearError, settle: store.settle,
    reload: () => { store.requestReset(); router.refresh() },
  }
}
