/**
 * Undo/redo for the Schedule tab (spec §14.1 "undo/redo implemented"; owner
 * decision Q8: every edit on the page is undoable — drag, resize, dialog,
 * bulk, delete, links, reorder, segments; Use template and Import are not).
 *
 * Pure: entries are serialisable operations plus their exact inverse; the
 * client's executor runs them through the same server actions. One user
 * gesture = one entry (one drag = one undo step, spec §14.2).
 *
 * A deleted task comes back as a NEW work item (the old one stays void in the
 * ledger — a work item cannot leave `void`), so after every re-create the
 * executor calls remapHistoryIds with the server's key → id map.
 *
 * `expectedUpdatedAt` is never stored in an entry: it would be stale by the
 * time the entry is replayed. The executor stamps each patch with the task's
 * live `updatedAt` when it runs the op.
 */
import type { LinkType, ScheduleTaskView } from '@esite/shared'
import type { LinkInput, TaskInput, TaskPatch } from './inputs'
import type { ScheduleLinkView } from './types'

export type ScheduleOp =
  | { kind: 'update'; patches: TaskPatch[] }
  | { kind: 'create'; tasks: TaskInput[]; links: LinkInput[] }
  | { kind: 'delete'; taskIds: string[] }
  | { kind: 'addLink'; predecessorId: string; successorId: string; type: LinkType; lagDays: number }
  | { kind: 'removeLink'; predecessorId: string; successorId: string }
  | { kind: 'updateLink'; predecessorId: string; successorId: string; type: LinkType; lagDays: number }
  | { kind: 'reorder'; orderedIds: string[] }

export interface HistoryEntry { label: string; forward: ScheduleOp[]; backward: ScheduleOp[] }
export interface History { past: HistoryEntry[]; future: HistoryEntry[] }

export const HISTORY_LIMIT = 50
export const EMPTY_HISTORY: History = { past: [], future: [] }

export function recordEntry(h: History, e: HistoryEntry): History {
  return { past: [...h.past, e].slice(-HISTORY_LIMIT), future: [] }
}
export function takeUndo(h: History): { entry: HistoryEntry; history: History } | null {
  const entry = h.past[h.past.length - 1]
  return entry ? { entry, history: { past: h.past.slice(0, -1), future: [entry, ...h.future] } } : null
}
export function takeRedo(h: History): { entry: HistoryEntry; history: History } | null {
  const [entry, ...rest] = h.future
  return entry ? { entry, history: { past: [...h.past, entry], future: rest } } : null
}

const PATCHABLE = [
  'name', 'category', 'zone', 'start', 'end', 'progress', 'colour', 'description', 'status', 'isMilestone', 'segments', 'ownerId',
] as const satisfies ReadonlyArray<keyof TaskPatch & keyof ScheduleTaskView>

function withoutToken(p: TaskPatch): TaskPatch {
  const { expectedUpdatedAt: _drop, ...rest } = p
  return rest
}

/** `before` = the tasks as they were; `patches` = what the user did. */
export function entryForUpdate(label: string, before: readonly ScheduleTaskView[], patches: TaskPatch[]): HistoryEntry {
  const byId = new Map(before.map((t) => [t.id, t]))
  const forward = patches.map(withoutToken)
  const back: TaskPatch[] = forward.map((p) => {
    const t = byId.get(p.id)
    const out: Record<string, unknown> = { id: p.id }
    if (!t) return out as TaskPatch
    for (const k of PATCHABLE) {
      if (p[k] === undefined) continue
      const v = t[k]
      out[k] = k === 'segments' ? (v as ScheduleTaskView['segments']).map((s) => ({ start: s.start, end: s.end })) : v
    }
    return out as TaskPatch
  })
  return { label, forward: [{ kind: 'update', patches: forward }], backward: [{ kind: 'update', patches: back }] }
}

export function snapshotTask(t: ScheduleTaskView): TaskInput {
  return {
    key: t.id, name: t.name, start: t.start, end: t.end, isMilestone: t.isMilestone, category: t.category, zone: t.zone,
    ownerId: t.ownerId, status: t.status, progress: t.progress, colour: t.colour, description: t.description,
    segments: t.segments.map((s) => ({ start: s.start, end: s.end })),
    // Undo of a delete keeps sign-off with the original person (Q1), not whoever pressed Undo.
    gatekeeperId: t.gatekeeperId,
  }
}

export function entryForDelete(label: string, tasks: readonly ScheduleTaskView[], links: readonly ScheduleLinkView[], ids: string[]): HistoryEntry {
  const gone = new Set(ids)
  return {
    label,
    forward: [{ kind: 'delete', taskIds: ids }],
    backward: [{
      kind: 'create',
      tasks: tasks.filter((t) => gone.has(t.id)).map(snapshotTask),
      links: links.filter((l) => gone.has(l.predecessorId) || gone.has(l.successorId))
        .map((l) => ({ from: l.predecessorId, to: l.successorId, type: l.type, lagDays: l.lagDays })),
    }],
  }
}

/** After a create: `ids` maps the client keys to the new task ids. */
export function entryForCreate(label: string, tasks: TaskInput[], links: LinkInput[], ids: Record<string, string>): HistoryEntry {
  const k = (key: string) => ids[key] ?? key
  return {
    label,
    forward: [{ kind: 'create', tasks: tasks.map((t) => ({ ...t, key: k(t.key) })), links: links.map((l) => ({ ...l, from: k(l.from), to: k(l.to) })) }],
    backward: [{ kind: 'delete', taskIds: tasks.map((t) => k(t.key)) }],
  }
}

export function entryForLinkAdd(l: { predecessorId: string; successorId: string; type: LinkType; lagDays: number }): HistoryEntry {
  const op = { kind: 'addLink' as const, predecessorId: l.predecessorId, successorId: l.successorId, type: l.type, lagDays: l.lagDays }
  return { label: 'Add link', forward: [op], backward: [{ kind: 'removeLink', predecessorId: l.predecessorId, successorId: l.successorId }] }
}
export function entryForLinkRemove(l: ScheduleLinkView): HistoryEntry {
  return {
    label: 'Remove link',
    forward: [{ kind: 'removeLink', predecessorId: l.predecessorId, successorId: l.successorId }],
    backward: [{ kind: 'addLink', predecessorId: l.predecessorId, successorId: l.successorId, type: l.type, lagDays: l.lagDays }],
  }
}
export function entryForLinkUpdate(before: ScheduleLinkView, type: LinkType, lagDays: number): HistoryEntry {
  const pair = { predecessorId: before.predecessorId, successorId: before.successorId }
  return {
    label: 'Edit link',
    forward: [{ kind: 'updateLink', ...pair, type, lagDays }],
    backward: [{ kind: 'updateLink', ...pair, type: before.type, lagDays: before.lagDays }],
  }
}
export function entryForReorder(before: string[], after: string[]): HistoryEntry {
  return { label: 'Reorder', forward: [{ kind: 'reorder', orderedIds: after }], backward: [{ kind: 'reorder', orderedIds: before }] }
}

function remapOp(op: ScheduleOp, m: (id: string) => string): ScheduleOp {
  switch (op.kind) {
    case 'update': return { ...op, patches: op.patches.map((p) => ({ ...p, id: m(p.id) })) }
    case 'create': return { ...op, tasks: op.tasks.map((t) => ({ ...t, key: m(t.key) })), links: op.links.map((l) => ({ ...l, from: m(l.from), to: m(l.to) })) }
    case 'delete': return { ...op, taskIds: op.taskIds.map(m) }
    case 'addLink':
    case 'removeLink':
    case 'updateLink': return { ...op, predecessorId: m(op.predecessorId), successorId: m(op.successorId) }
    case 'reorder': return { ...op, orderedIds: op.orderedIds.map(m) }
  }
}

/** A re-create gave tasks new ids: rewrite every entry that names the old ones. */
export function remapHistoryIds(h: History, map: Record<string, string>): History {
  const m = (id: string) => map[id] ?? id
  const e = (x: HistoryEntry): HistoryEntry => ({ ...x, forward: x.forward.map((o) => remapOp(o, m)), backward: x.backward.map((o) => remapOp(o, m)) })
  return { past: h.past.map(e), future: h.future.map(e) }
}
