import { ACT_FIELDS, PROG_FIELDS, type ProgrammeFields, type ProgrammeOp, type ProgrammeState } from '../persistence/ops'
import type { ActivityRow, DependencyRow } from '../persistence/rows'

const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b)
const DEP_FIELDS = ['type', 'lag', 'lag_unit', 'lag_calendar'] as const

/**
 * The ops that turn `from` into `to`, for undo and redo.
 *
 * Covers the programme row, activities and dependencies (calendars, exceptions and codes are not edited
 * on the Gantt, so they are not diffed). Only writable fields are emitted, never cache columns.
 *
 * - Order: dependency deletes, `set_programme`, activity upserts (parents before children, in the order of
 *   the `to` tree, which cannot make a transient cycle), dependency upserts, activity deletes (deepest first).
 * - Matching is by id. A tombstoned activity counts as absent on both sides.
 * - P2 cannot restore a tombstoned activity (an upsert on it is refused). So an activity that is live in
 *   `to` but tombstoned (or missing) in `from` is created as a NEW row under a new key, and references to it
 *   in `to` (parent, link ends) are rewritten to that key. The old tombstone stays. Deleting a row that has
 *   history tombstones it in P2, so undo of such a delete yields a new row, not the old id.
 * - Every new row carries a non-blank key from `newKey`.
 */
export function diffToOps(from: ProgrammeState, to: ProgrammeState, newKey: () => string): ProgrammeOp[] {
  const mint = (): string => {
    const k = newKey()
    if (typeof k !== 'string' || k.trim() === '') throw new Error('newKey must return a non-blank key.')
    return k
  }
  const fromLive = new Map(from.activities.filter((a) => !a.is_tombstoned).map((a) => [a.id, a]))
  const toLive = new Map(to.activities.filter((a) => !a.is_tombstoned).map((a) => [a.id, a]))
  /** `to` id → key, for activities that must be created. */
  const created = new Map<string, string>()
  for (const a of to.activities) if (!a.is_tombstoned && !fromLive.has(a.id)) created.set(a.id, mint())
  const ref = (id: string): string => created.get(id) ?? id

  const ops: ProgrammeOp[] = []

  // 1. dependency deletes (so a removed link cannot collide with a new one)
  const toDeps = new Map(to.dependencies.filter((d) => toLive.has(d.pred_id) && toLive.has(d.succ_id)).map((d) => [d.id, d]))
  const fromDepIds = new Set(from.dependencies.map((d) => d.id))
  for (const d of from.dependencies) if (!toDeps.has(d.id)) ops.push({ op: 'delete_dependency', id: d.id })

  // 2. programme
  const pf: Record<string, unknown> = {}
  for (const f of PROG_FIELDS) if (!same(from.programme[f], to.programme[f])) pf[f] = to.programme[f]
  if (Object.keys(pf).length > 0) ops.push({ op: 'set_programme', fields: pf as ProgrammeFields })

  // 3. activity upserts, parents first (depth in the `to` tree)
  const depth = new Map<string, number>()
  const depthOf = (a: ActivityRow): number => {
    const known = depth.get(a.id)
    if (known !== undefined) return known
    depth.set(a.id, 0) // cycle guard
    const p = a.parent_id === null ? undefined : toLive.get(a.parent_id)
    const d = p ? depthOf(p) + 1 : 0
    depth.set(a.id, d)
    return d
  }
  const toOrder = [...toLive.values()].map((a, i) => ({ a, i, d: depthOf(a) })).sort((x, y) => x.d - y.d || x.i - y.i)
  for (const { a } of toOrder) {
    const parent = a.parent_id === null ? null : ref(a.parent_id)
    if (created.has(a.id)) {
      const fields: Record<string, unknown> = {}
      for (const f of ACT_FIELDS) fields[f] = a[f]
      fields.parent_id = parent
      ops.push({ op: 'upsert_activity', key: created.get(a.id), fields })
    } else {
      const prev = fromLive.get(a.id) as ActivityRow
      const fields: Record<string, unknown> = {}
      for (const f of ACT_FIELDS) {
        const next = f === 'parent_id' ? parent : a[f]
        if (!same(prev[f], next)) fields[f] = next
      }
      if (Object.keys(fields).length > 0) ops.push({ op: 'upsert_activity', id: a.id, fields })
    }
  }

  // 4. dependency upserts
  for (const d of toDeps.values()) {
    if (!fromDepIds.has(d.id)) {
      ops.push({ op: 'upsert_dependency', key: mint(), pred: ref(d.pred_id), succ: ref(d.succ_id), type: d.type, lag: d.lag, lag_unit: d.lag_unit, lag_calendar: d.lag_calendar })
      continue
    }
    const prev = from.dependencies.find((x) => x.id === d.id) as DependencyRow
    const op: Record<string, unknown> = { op: 'upsert_dependency', id: d.id }
    let changed = false
    if (prev.pred_id !== d.pred_id) { op.pred = ref(d.pred_id); changed = true }
    if (prev.succ_id !== d.succ_id) { op.succ = ref(d.succ_id); changed = true }
    for (const f of DEP_FIELDS) if (!same(prev[f], d[f])) { op[f] = d[f]; changed = true }
    if (changed) ops.push(op as unknown as ProgrammeOp)
  }

  // 5. activity deletes, deepest first (in the `from` tree)
  const fromDepth = new Map<string, number>()
  const fdepth = (a: ActivityRow): number => {
    const known = fromDepth.get(a.id)
    if (known !== undefined) return known
    fromDepth.set(a.id, 0)
    const p = a.parent_id === null ? undefined : fromLive.get(a.parent_id)
    const d = p ? fdepth(p) + 1 : 0
    fromDepth.set(a.id, d)
    return d
  }
  const gone = [...fromLive.values()].filter((a) => !toLive.has(a.id)).map((a, i) => ({ a, i, d: fdepth(a) }))
    .sort((x, y) => y.d - x.d || x.i - y.i)
  for (const { a } of gone) ops.push({ op: 'delete_activity', id: a.id })
  return ops
}
