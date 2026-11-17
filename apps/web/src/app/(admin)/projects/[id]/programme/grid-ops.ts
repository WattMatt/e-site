/**
 * The grid's structural gestures as pure functions: activities + selection in, ops out.
 *
 * Each gesture works on a copy of the live rows, moves rows between sibling lists, renumbers
 * every list it touched (`sort_order` = 1, 2, 3 …), then emits one `upsert_activity` per row
 * whose writable fields changed. Siblings are ordered exactly as `outlineRows` orders them
 * (sort_order, nulls last, then name, then id), so what the person sees is what moves.
 *
 * - A task that gains children becomes a summary; a summary left with none becomes a task
 *   again (at least one working day), as MS Project does. A milestone or a level-of-effort
 *   row never gains children: the gesture is refused with a sentence.
 * - Indent is all-or-nothing: if any selected row has no previous sibling, nothing moves.
 * - Outdent follows MS Project: the row keeps its place on screen, so the siblings that
 *   followed it under its old parent become its children.
 * - A selected row whose ancestor is also selected moves with that ancestor, not on its own.
 */
import { outlineRows, type ActivityFields, type ActivityRow, type ProgrammeOp } from '@esite/shared/programme'

export const MILESTONE_NO_CHILDREN = "A milestone can't have sub-activities."
export const LOE_NO_CHILDREN = "A level-of-effort activity can't have sub-activities."

/** A structural gesture's result: the ops, or the sentence saying why it was refused. */
export interface Gesture { ops: ProgrammeOp[]; error: string | null }
const NOTHING: Gesture = { ops: [], error: null }

/** Why `type` cannot be a parent, or null when it can. */
function noChildren(type: ActivityRow['type']): string | null {
  if (type === 'start_milestone' || type === 'finish_milestone') return MILESTONE_NO_CHILDREN
  if (type === 'level_of_effort') return LOE_NO_CHILDREN
  return null
}

type Mutable = Pick<ActivityRow, 'id' | 'name' | 'parent_id' | 'sort_order' | 'type' | 'original_duration'>
const TRACKED = ['parent_id', 'sort_order', 'type', 'original_duration'] as const

function cmp(x: Mutable, y: Mutable): number {
  const sx = x.sort_order ?? Number.POSITIVE_INFINITY
  const sy = y.sort_order ?? Number.POSITIVE_INFINITY
  if (sx !== sy) return sx < sy ? -1 : 1
  if (x.name !== y.name) return x.name < y.name ? -1 : 1
  return x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}

class Work {
  readonly rows = new Map<string, Mutable>()
  private readonly original = new Map<string, Mutable>()

  constructor(activities: readonly ActivityRow[]) {
    const live = activities.filter((a) => !a.is_tombstoned)
    const ids = new Set(live.map((a) => a.id))
    for (const a of live) {
      // A row whose parent is missing shows at the top level, so it moves as one.
      const parent_id = a.parent_id !== null && ids.has(a.parent_id) ? a.parent_id : null
      const m: Mutable = { id: a.id, name: a.name, parent_id, sort_order: a.sort_order, type: a.type, original_duration: a.original_duration }
      this.rows.set(a.id, m)
      this.original.set(a.id, { ...m })
    }
  }

  kids(parent: string | null): Mutable[] {
    return [...this.rows.values()].filter((r) => r.parent_id === parent).sort(cmp)
  }

  private renumber(list: Mutable[]): void {
    list.forEach((r, i) => { r.sort_order = i + 1 })
  }

  /** Moves `id` into `parent`'s children at `index`, renumbering both lists and fixing types. */
  place(id: string, parent: string | null, index: number): void {
    const r = this.rows.get(id)!
    const from = r.parent_id
    const old = this.kids(from).filter((x) => x.id !== id)
    this.renumber(old)
    const target = parent === from ? old : this.kids(parent).filter((x) => x.id !== id)
    r.parent_id = parent
    target.splice(Math.max(0, Math.min(index, target.length)), 0, r)
    this.renumber(target)
    this.fixTypes(parent, from)
  }

  fixTypes(...parents: Array<string | null>): void {
    for (const p of parents) {
      if (p === null) continue
      const row = this.rows.get(p)
      if (!row) continue
      const hasKids = this.kids(p).length > 0
      if (hasKids && row.type !== 'summary' && row.type !== 'module_summary') row.type = 'summary'
      if (!hasKids && row.type === 'summary') {
        row.type = 'task'
        row.original_duration = Math.max(1, row.original_duration)
      }
    }
  }

  /** One upsert per existing row whose tracked fields changed; `skip` rows are emitted by the caller. */
  ops(skip: ReadonlySet<string> = new Set()): ProgrammeOp[] {
    const out: ProgrammeOp[] = []
    for (const [id, r] of this.rows) {
      if (skip.has(id)) continue
      const o = this.original.get(id)
      if (!o) continue
      const fields: ActivityFields = {}
      for (const k of TRACKED) if (r[k] !== o[k]) (fields as Record<string, unknown>)[k] = r[k]
      if (Object.keys(fields).length > 0) out.push({ op: 'upsert_activity', id, fields })
    }
    return out
  }
}

/** Selected ids in outline order, without those whose ancestor is selected too. */
function topSelected(activities: readonly ActivityRow[], work: Work, selected: ReadonlySet<string>): string[] {
  const order = outlineRows(activities as ActivityRow[], new Set()).map((r) => r.id)
  const covered = (id: string): boolean => {
    let p = work.rows.get(id)?.parent_id ?? null
    while (p !== null) {
      if (selected.has(p)) return true
      p = work.rows.get(p)?.parent_id ?? null
    }
    return false
  }
  return order.filter((id) => selected.has(id) && !covered(id))
}

export function indentOps(activities: readonly ActivityRow[], selected: ReadonlySet<string>): Gesture {
  const w = new Work(activities)
  for (const id of topSelected(activities, w, selected)) {
    const r = w.rows.get(id)!
    const sibs = w.kids(r.parent_id)
    const i = sibs.findIndex((x) => x.id === id)
    if (i <= 0) return NOTHING
    const parent = sibs[i - 1]
    const refused = noChildren(parent.type)
    if (refused) return { ops: [], error: refused }
    w.place(id, parent.id, w.kids(parent.id).length)
  }
  return { ops: w.ops(), error: null }
}

export function outdentOps(activities: readonly ActivityRow[], selected: ReadonlySet<string>): Gesture {
  const w = new Work(activities)
  // Last first: each lands straight after the old parent, so the block keeps its order.
  for (const id of topSelected(activities, w, selected).reverse()) {
    const r = w.rows.get(id)!
    if (r.parent_id === null) continue
    const parent = w.rows.get(r.parent_id)!
    const sibs = w.kids(parent.id)
    const following = sibs.slice(sibs.findIndex((x) => x.id === id) + 1)
    if (following.length > 0) {
      const refused = noChildren(r.type)
      if (refused) return { ops: [], error: refused }
    }
    const grand = parent.parent_id
    w.place(id, grand, w.kids(grand).findIndex((x) => x.id === parent.id) + 1)
    for (const f of following) w.place(f.id, id, w.kids(id).length)
  }
  return { ops: w.ops(), error: null }
}

export function moveOps(activities: readonly ActivityRow[], selected: ReadonlySet<string>, direction: 'up' | 'down'): ProgrammeOp[] {
  const w = new Work(activities)
  const ids = topSelected(activities, w, selected)
  for (const id of direction === 'up' ? ids : ids.reverse()) {
    const r = w.rows.get(id)!
    const sibs = w.kids(r.parent_id)
    const i = sibs.findIndex((x) => x.id === id)
    const j = direction === 'up' ? i - 1 : i + 1
    if (j < 0 || j >= sibs.length || selected.has(sibs[j].id)) continue
    w.place(id, r.parent_id, j)
  }
  return w.ops()
}

export type NewRowKind = 'task' | 'milestone'

/** A new task or milestone as the next sibling of `after` (or last at the top level). */
export function addOps(activities: readonly ActivityRow[], after: string | null, kind: NewRowKind, key: string): ProgrammeOp[] {
  const w = new Work(activities)
  const anchor = after !== null ? w.rows.get(after) ?? null : null
  const parent = anchor ? anchor.parent_id : null
  const sibs = w.kids(parent)
  const at = anchor ? sibs.findIndex((x) => x.id === anchor.id) + 1 : sibs.length
  const id = `key:${key}`
  const fields = kind === 'task'
    ? { name: 'New task', type: 'task' as const, original_duration: 1 }
    : { name: 'New milestone', type: 'finish_milestone' as const, original_duration: 0 }
  w.rows.set(id, { id, ...fields, parent_id: parent, sort_order: null })
  w.place(id, parent, at)
  const created = w.rows.get(id)!
  return [
    { op: 'upsert_activity', key, fields: { ...fields, parent_id: parent, sort_order: created.sort_order } },
    ...w.ops(new Set([id])),
  ]
}

/** The rows a delete of `selected` removes: the selection and every live descendant. */
export function deletionSet(activities: readonly ActivityRow[], selected: ReadonlySet<string>): string[] {
  const order = outlineRows(activities as ActivityRow[], new Set()).map((r) => r.id)
  const w = new Work(activities)
  const doomed = (id: string): boolean => {
    let cur: string | null = id
    while (cur !== null) {
      if (selected.has(cur)) return true
      cur = w.rows.get(cur)?.parent_id ?? null
    }
    return false
  }
  return order.filter(doomed)
}

/** Children before parents; a summary left with no children becomes a task again. */
export function deleteOps(activities: readonly ActivityRow[], selected: ReadonlySet<string>): ProgrammeOp[] {
  const ids = deletionSet(activities, selected)
  const w = new Work(activities)
  const parents = new Set<string | null>()
  for (const id of ids) parents.add(w.rows.get(id)?.parent_id ?? null)
  for (const id of ids) w.rows.delete(id)
  w.fixTypes(...[...parents].filter((p) => p === null || w.rows.has(p)))
  const deletes: ProgrammeOp[] = [...ids].reverse().map((id) => ({ op: 'delete_activity', id }))
  return [...deletes, ...w.ops()]
}
