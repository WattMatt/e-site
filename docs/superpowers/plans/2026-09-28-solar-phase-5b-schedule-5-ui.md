# E-Site Solar Phase 5b — Schedule (Gantt) — Part 5 of 5: the Schedule tab UI, RBAC, suites, PR

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal / Architecture / Tech stack / Ground rules:** see Part 1. **Prerequisite:** Parts 1–4 committed.

UI conventions mirrored from the existing Solar tabs: CSS variables (`var(--c-amber)`, `var(--c-border)`, `var(--c-text-dim)` …), `Card / CardHeader / CardBody` from `@/components/ui/Card`, two-step destructive confirms with `useArmedConfirm` (`solar/_components/useArmedConfirm.ts`), controls above the caller's level **hidden**, props JSON-only, and — from the cable-route work (#190/#201) — **never `router.refresh()` after a canvas mutation**: the client calls `loadScheduleAction` and replaces its data, so the Konva stage is never re-mounted.

Konva cannot render under jsdom (known gap, as for `RouteCanvas`/`MarkupCanvas`), so `GanttCanvas` has no component test: its geometry is `layoutGantt()` (tested in Part 2) and its interactions go through callbacks that `ScheduleClient`'s test drives with a stub canvas.

---

### Task 21: Undo / redo that actually applies — `history.ts`

**Files:**
- Create: `apps/web/src/lib/solar/schedule/history.ts`, `history.test.ts`

WM's undo stack was never pushed and never applied an inverse (as-is/06 B.6.3). Here every user action records an entry of **serialisable operations** with its exact inverse; the client's executor (Task 29) runs them through the same server actions. A deleted task comes back as a NEW work item (the old one stays void in the ledger — a work item cannot leave `void`), so the history remaps ids after every re-create.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/schedule/history.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import {
  EMPTY_HISTORY, HISTORY_LIMIT, recordEntry, takeUndo, takeRedo, remapHistoryIds,
  entryForUpdate, entryForDelete, entryForCreate, entryForLinkAdd, entryForReorder,
} from './history'
import type { ScheduleTaskView } from '@esite/shared'
import type { ScheduleLinkView } from './types'

const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'C', zone: 'Z', start: '2026-10-01', end: '2026-10-03',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, progress: 30, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
  sortOrder: 1, description: 'd', updatedAt: 'U', segments: [], ...over,
})
const link = (p: string, s: string): ScheduleLinkView => ({ id: `${p}${s}`, predecessorId: p, successorId: s, type: 'FS', lagDays: 1 })

describe('entries carry their exact inverse', () => {
  it('update: backward restores only the keys that changed, from the BEFORE state', () => {
    const e = entryForUpdate('Move task', [task('a')], [{ id: 'a', start: '2026-10-04', end: '2026-10-06' }])
    expect(e.forward).toEqual([{ kind: 'update', patches: [{ id: 'a', start: '2026-10-04', end: '2026-10-06' }] }])
    expect(e.backward).toEqual([{ kind: 'update', patches: [{ id: 'a', start: '2026-10-01', end: '2026-10-03' }] }])
  })
  it('update of status/owner/segments restores them too', () => {
    const e = entryForUpdate('Bulk', [task('a', { segments: [{ start: '2026-10-01', end: '2026-10-01' }, { start: '2026-10-03', end: '2026-10-03' }] })],
      [{ id: 'a', status: 'done', ownerId: 'u2', segments: [] }])
    expect(e.backward[0]).toEqual({ kind: 'update', patches: [{ id: 'a', status: 'in_progress', ownerId: 'u1',
      segments: [{ start: '2026-10-01', end: '2026-10-01' }, { start: '2026-10-03', end: '2026-10-03' }] }] })
  })
  it('delete: backward re-creates the tasks AND every link that touched them, keyed by the old ids', () => {
    const e = entryForDelete('Delete 1 task', [task('a'), task('b')], [link('a', 'b'), link('b', 'c')], ['b'])
    expect(e.forward).toEqual([{ kind: 'delete', taskIds: ['b'] }])
    expect(e.backward).toEqual([{
      kind: 'create',
      tasks: [expect.objectContaining({ key: 'b', name: 'Task b', start: '2026-10-01', end: '2026-10-03', ownerId: 'u1', status: 'in_progress', progress: 30, category: 'C', zone: 'Z' })],
      links: [{ from: 'a', to: 'b', type: 'FS', lagDays: 1 }, { from: 'b', to: 'c', type: 'FS', lagDays: 1 }],
    }])
  })
  it('create: backward deletes the ids the server returned', () => {
    const e = entryForCreate('Add task', [{ key: 'new', name: 'N', start: '2026-10-01', end: '2026-10-01' }], [], { new: 't9' })
    expect(e.backward).toEqual([{ kind: 'delete', taskIds: ['t9'] }])
    expect(e.forward).toEqual([{ kind: 'create', tasks: [{ key: 't9', name: 'N', start: '2026-10-01', end: '2026-10-01' }], links: [] }])
  })
  it('link add and reorder', () => {
    expect(entryForLinkAdd({ predecessorId: 'a', successorId: 'b', type: 'SS', lagDays: 2 }).backward)
      .toEqual([{ kind: 'removeLink', predecessorId: 'a', successorId: 'b' }])
    expect(entryForReorder(['a', 'b'], ['b', 'a']).backward).toEqual([{ kind: 'reorder', orderedIds: ['a', 'b'] }])
  })
})

describe('the stack', () => {
  it('undo then redo walk the same entry; a new action clears redo', () => {
    const e1 = entryForReorder(['a', 'b'], ['b', 'a'])
    let h = recordEntry(EMPTY_HISTORY, e1)
    const u = takeUndo(h)!
    expect(u.entry).toBe(e1)
    h = u.history
    expect(takeUndo(h)).toBeNull()
    const r = takeRedo(h)!
    expect(r.entry).toBe(e1)
    h = recordEntry(u.history, entryForReorder(['a'], ['a']))
    expect(takeRedo(h)).toBeNull()
  })
  it('keeps at most HISTORY_LIMIT entries', () => {
    let h = EMPTY_HISTORY
    for (let i = 0; i < HISTORY_LIMIT + 5; i++) h = recordEntry(h, entryForReorder([String(i)], [String(i)]))
    expect(h.past).toHaveLength(HISTORY_LIMIT)
  })
  it('remaps every op after a re-create gives a task a new id', () => {
    const del = entryForDelete('Delete', [task('b')], [link('a', 'b')], ['b'])
    const move = entryForUpdate('Move', [task('b')], [{ id: 'b', start: '2026-10-05', end: '2026-10-07' }])
    const h = remapHistoryIds(recordEntry(recordEntry(EMPTY_HISTORY, move), del), { b: 'b2' })
    expect(h.past[0].forward).toEqual([{ kind: 'update', patches: [{ id: 'b2', start: '2026-10-05', end: '2026-10-07' }] }])
    expect(h.past[1].forward).toEqual([{ kind: 'delete', taskIds: ['b2'] }])
    const back = h.past[1].backward[0]
    expect(back.kind === 'create' && back.tasks[0].key).toBe('b2')
    expect(back.kind === 'create' && back.links).toEqual([{ from: 'a', to: 'b2', type: 'FS', lagDays: 1 }])
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/history.test.ts`
Expected: FAIL — cannot resolve `./history`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/schedule/history.ts`:
```ts
/**
 * Undo/redo for the Schedule tab (spec §14.1 "undo/redo implemented"). Pure:
 * entries are serialisable operations plus their exact inverse; the client
 * runs them through the server actions. One user gesture = one entry (one
 * drag = one undo step, spec §14.2).
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

const PATCHABLE: Array<keyof TaskPatch & keyof ScheduleTaskView> = [
  'name', 'category', 'zone', 'start', 'end', 'progress', 'colour', 'description', 'status', 'isMilestone', 'segments',
]

/** `before` = the tasks as they were; `patches` = what the user did. */
export function entryForUpdate(label: string, before: readonly ScheduleTaskView[], patches: TaskPatch[]): HistoryEntry {
  const byId = new Map(before.map((t) => [t.id, t]))
  const back: TaskPatch[] = patches.map((p) => {
    const t = byId.get(p.id)
    const out: TaskPatch = { id: p.id }
    if (!t) return out
    for (const k of PATCHABLE) if (p[k] !== undefined) (out as Record<string, unknown>)[k] = t[k]
    if (p.ownerId !== undefined) out.ownerId = t.ownerId
    return out
  })
  return { label, forward: [{ kind: 'update', patches }], backward: [{ kind: 'update', patches: back }] }
}

export function snapshotTask(t: ScheduleTaskView): TaskInput {
  return {
    key: t.id, name: t.name, start: t.start, end: t.end, isMilestone: t.isMilestone, category: t.category, zone: t.zone,
    ownerId: t.ownerId, status: t.status, progress: t.progress, colour: t.colour, description: t.description, segments: t.segments,
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
  return { label: 'Add link', forward: [{ kind: 'addLink', ...l }], backward: [{ kind: 'removeLink', predecessorId: l.predecessorId, successorId: l.successorId }] }
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
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/history.test.ts`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/schedule/history.ts apps/web/src/lib/solar/schedule/history.test.ts
git commit -m "feat(solar-schedule): undo/redo history with exact inverses and id remapping after re-create

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 22: Keyboard shortcuts — one table drives both the handler and the `?` overlay

**Files:**
- Create: `apps/web/src/lib/solar/schedule/shortcuts.ts`, `shortcuts.test.ts`

WM listed shortcuts that did nothing (undo/redo), overrode browser find and select-all, made `Ctrl +` unreachable (it needs Shift), and deleted on `Delete` with no confirmation (as-is/06 B.2.12). Here every listed shortcut carries an example event and the test proves each one matches its action; `Delete` only **arms** the two-step confirm; search is `/` (browser find is left alone); zoom-in accepts `=` and `+` with or without Shift.

- [ ] **Step 1: Write the failing test**

`apps/web/src/lib/solar/schedule/shortcuts.test.ts`:
```ts
import { describe, it, expect } from 'vitest'
import { SCHEDULE_SHORTCUTS, matchShortcut } from './shortcuts'

const k = (key: string, mods: Partial<{ ctrlKey: boolean; metaKey: boolean; shiftKey: boolean; altKey: boolean }> = {}, tagName = 'DIV') =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName, isContentEditable: false }, ...mods })

describe('every listed shortcut works (listed == functional)', () => {
  for (const s of SCHEDULE_SHORTCUTS) {
    it(`${s.label}`, () => {
      expect(matchShortcut(s.example, true)).toBe(s.action)
    })
  }
})

describe('matchShortcut', () => {
  it('undo, redo (both chords), on Ctrl and on ⌘', () => {
    expect(matchShortcut(k('z', { ctrlKey: true }), true)).toBe('undo')
    expect(matchShortcut(k('z', { metaKey: true }), true)).toBe('undo')
    expect(matchShortcut(k('Z', { metaKey: true, shiftKey: true }), true)).toBe('redo')
    expect(matchShortcut(k('y', { ctrlKey: true }), true)).toBe('redo')
  })
  it('zoom in with = or + whether or not Shift is down', () => {
    expect(matchShortcut(k('=', { ctrlKey: true }), true)).toBe('zoomIn')
    expect(matchShortcut(k('+', { ctrlKey: true, shiftKey: true }), true)).toBe('zoomIn')
    expect(matchShortcut(k('-', { ctrlKey: true }), true)).toBe('zoomOut')
  })
  it('leaves browser find alone and ignores typing in fields', () => {
    expect(matchShortcut(k('f', { ctrlKey: true }), true)).toBeNull()
    expect(matchShortcut(k('n', {}, 'INPUT'), true)).toBeNull()
    expect(matchShortcut(k('Delete', {}, 'TEXTAREA'), true)).toBeNull()
    expect(matchShortcut(k('Escape', {}, 'INPUT'), true)).toBe('clearSelection')
  })
  it('edit shortcuts do nothing at View level; view shortcuts still work', () => {
    expect(matchShortcut(k('n'), false)).toBeNull()
    expect(matchShortcut(k('Delete'), false)).toBeNull()
    expect(matchShortcut(k('z', { ctrlKey: true }), false)).toBeNull()
    expect(matchShortcut(k('/'), false)).toBe('focusSearch')
    expect(matchShortcut(k('?', { shiftKey: true }), false)).toBe('help')
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/shortcuts.test.ts`
Expected: FAIL — cannot resolve `./shortcuts`.

- [ ] **Step 3: Implement**

`apps/web/src/lib/solar/schedule/shortcuts.ts`:
```ts
/** Schedule tab keyboard shortcuts. The overlay renders SCHEDULE_SHORTCUTS; the handler uses matchShortcut. */
export type ShortcutAction =
  | 'newTask' | 'newMilestone' | 'deleteSelected' | 'undo' | 'redo' | 'selectAll' | 'clearSelection'
  | 'zoomIn' | 'zoomOut' | 'focusSearch' | 'today' | 'help'

export interface KeyLike {
  key: string
  ctrlKey: boolean
  metaKey: boolean
  shiftKey: boolean
  altKey: boolean
  target?: { tagName?: string; isContentEditable?: boolean } | null
}

export interface ScheduleShortcut {
  action: ShortcutAction
  group: 'Tasks' | 'Edit' | 'Selection' | 'View'
  label: string
  keys: string
  editOnly: boolean
  example: KeyLike
  match: (e: KeyLike, mod: boolean) => boolean
}

const ev = (key: string, m: Partial<KeyLike> = {}): KeyLike =>
  ({ key, ctrlKey: false, metaKey: false, shiftKey: false, altKey: false, target: { tagName: 'DIV' }, ...m })
const plain = (e: KeyLike, mod: boolean) => !mod && !e.altKey

export const SCHEDULE_SHORTCUTS: ScheduleShortcut[] = [
  { action: 'newTask', group: 'Tasks', label: 'New task', keys: 'N', editOnly: true, example: ev('n'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 'n' },
  { action: 'newMilestone', group: 'Tasks', label: 'New milestone', keys: 'M', editOnly: true, example: ev('m'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 'm' },
  { action: 'deleteSelected', group: 'Tasks', label: 'Delete selected (asks to confirm)', keys: 'Delete / Backspace', editOnly: true, example: ev('Delete'), match: (e, mod) => plain(e, mod) && (e.key === 'Delete' || e.key === 'Backspace') },
  { action: 'undo', group: 'Edit', label: 'Undo', keys: 'Ctrl/⌘ Z', editOnly: true, example: ev('z', { ctrlKey: true }), match: (e, mod) => mod && !e.shiftKey && e.key.toLowerCase() === 'z' },
  { action: 'redo', group: 'Edit', label: 'Redo', keys: 'Ctrl/⌘ Shift Z, Ctrl/⌘ Y', editOnly: true, example: ev('z', { metaKey: true, shiftKey: true }), match: (e, mod) => mod && ((e.shiftKey && e.key.toLowerCase() === 'z') || e.key.toLowerCase() === 'y') },
  { action: 'selectAll', group: 'Selection', label: 'Select all shown tasks', keys: 'Ctrl/⌘ A', editOnly: false, example: ev('a', { ctrlKey: true }), match: (e, mod) => mod && e.key.toLowerCase() === 'a' },
  { action: 'clearSelection', group: 'Selection', label: 'Clear selection / cancel', keys: 'Esc', editOnly: false, example: ev('Escape'), match: (e) => e.key === 'Escape' },
  { action: 'zoomIn', group: 'View', label: 'Zoom in', keys: 'Ctrl/⌘ + (or =)', editOnly: false, example: ev('=', { ctrlKey: true }), match: (e, mod) => mod && (e.key === '=' || e.key === '+') },
  { action: 'zoomOut', group: 'View', label: 'Zoom out', keys: 'Ctrl/⌘ −', editOnly: false, example: ev('-', { ctrlKey: true }), match: (e, mod) => mod && (e.key === '-' || e.key === '_') },
  { action: 'focusSearch', group: 'View', label: 'Search tasks', keys: '/', editOnly: false, example: ev('/'), match: (e, mod) => plain(e, mod) && e.key === '/' },
  { action: 'today', group: 'View', label: 'Scroll to today', keys: 'T', editOnly: false, example: ev('t'), match: (e, mod) => plain(e, mod) && e.key.toLowerCase() === 't' },
  { action: 'help', group: 'View', label: 'Show shortcuts', keys: '?', editOnly: false, example: ev('?', { shiftKey: true }), match: (e, mod) => !mod && e.key === '?' },
]

const TYPING = new Set(['INPUT', 'TEXTAREA', 'SELECT'])

export function matchShortcut(e: KeyLike, canEdit: boolean): ShortcutAction | null {
  const typing = !!e.target && (TYPING.has(String(e.target.tagName ?? '').toUpperCase()) || e.target.isContentEditable === true)
  if (typing && e.key !== 'Escape') return null
  const mod = e.ctrlKey || e.metaKey
  for (const s of SCHEDULE_SHORTCUTS) {
    if (s.editOnly && !canEdit) continue
    if (s.match(e, mod)) return s.action
  }
  return null
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run src/lib/solar/schedule/shortcuts.test.ts`
Expected: PASS (12 listed + 4 behaviour tests).

- [ ] **Step 5: Commit**

```bash
git add apps/web/src/lib/solar/schedule/shortcuts.ts apps/web/src/lib/solar/schedule/shortcuts.test.ts
git commit -m "feat(solar-schedule): keyboard shortcuts — every listed one proven functional; Delete asks first

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 23: Enable the Schedule tab and its readiness step

**Files:**
- Modify: `packages/shared/src/solar/readiness.ts:34` (tab `built`) and `computeSolarReadiness` (`:100-106`)
- Modify: `packages/shared/src/solar/readiness.test.ts`
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx` (task count → readiness)
- Modify: `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx:35`

Spec §1.3 (functional spec line 163): Schedule is **green** with ≥ 1 task and every task has start, end and owner (all three are NOT NULL in 00213, so any task qualifies), **grey** with none; the **red** "dependency cycle exists" case cannot arise (00213 refuses loops at write time) and is therefore not modelled.

- [ ] **Step 1: Write the failing test**

Add to `packages/shared/src/solar/readiness.test.ts`:
```ts
describe('schedule readiness', () => {
  it('grey with no tasks, green with any, and the tab is built', () => {
    const none = computeSolarReadiness(null, 'edit', { scheduleTaskCount: 0 }).find((s) => s.slug === 'schedule')!
    expect(none).toMatchObject({ status: 'grey', reason: 'Not started', live: true })
    const some = computeSolarReadiness(null, 'view', { scheduleTaskCount: 3 }).find((s) => s.slug === 'schedule')!
    expect(some).toMatchObject({ status: 'green', reason: '3 tasks scheduled', live: true })
    expect(computeSolarReadiness(null, 'view', { scheduleTaskCount: 1 }).find((s) => s.slug === 'schedule')!.reason).toBe('1 task scheduled')
    expect(SOLAR_TABS.find((t) => t.slug === 'schedule')!.built).toBe(true)
  })
  it('an unknown count reads as not started (callers that do not load it)', () => {
    expect(computeSolarReadiness(null, 'view').find((s) => s.slug === 'schedule')!.status).toBe('grey')
  })
})
```
(Import `SOLAR_TABS` in that file's existing `./readiness` import if not already imported.)

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter @esite/shared exec vitest run src/solar/readiness.test.ts`
Expected: FAIL — `built` is false and the third argument is ignored.

- [ ] **Step 3: Implement**

In `packages/shared/src/solar/readiness.ts`: change the schedule row to
```ts
  { slug: 'schedule',   label: 'Schedule',           built: true,  financial: false, hidden: false },
```
and replace `computeSolarReadiness` with:
```ts
export interface ReadinessExtras {
  /** Live solar.schedule_tasks rows on the project; null/undefined = not loaded. */
  scheduleTaskCount?: number | null
}

export function scheduleReadiness(count: number | null | undefined): { status: ReadinessStatus; reason: string } {
  if (!count) return { status: 'grey', reason: 'Not started' }
  return { status: 'green', reason: `${count} ${count === 1 ? 'task' : 'tasks'} scheduled` }
}

export function computeSolarReadiness(site: SiteReadinessInput | null, level: SolarAccessLevel, extras: ReadinessExtras = {}): ReadinessStep[] {
  return visibleSolarTabs(level)
    .filter((t): t is SolarTab & { slug: Exclude<SolarTabSlug, 'overview'> } => t.slug !== 'overview')
    .map((t) => {
      if (t.slug === 'site') return { slug: t.slug, label: t.label, live: true, ...siteReadiness(site) }
      if (t.slug === 'schedule') return { slug: t.slug, label: t.label, live: true, ...scheduleReadiness(extras.scheduleTaskCount) }
      return { slug: t.slug, label: t.label, live: false, status: 'grey' as const, reason: LATER_PHASE_REASON }
    })
}
```

In `…/solar/(gated)/layout.tsx`, extend the `Promise.all` with a fourth read and pass the count:
```ts
  const [{ data: project }, { data: study }, grantorRes, scheduleRes] = await Promise.all([
    supabase.schema('projects').from('projects').select('name, organisation_id').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('studies').select('latitude, longitude, licensee_name, nmd_kva').eq('project_id', id).maybeSingle(),
    supabase.rpc('solar_is_grantor', { p_project_id: id }),
    supabase.schema('solar').from('schedule_tasks').select('id', { count: 'exact', head: true }).eq('project_id', id),
  ])
```
and
```ts
  const scheduleTaskCount = (scheduleRes as { count?: number | null }).count
    ?? (Array.isArray((scheduleRes as { data?: unknown }).data) ? ((scheduleRes as { data: unknown[] }).data).length : 0)
  const readiness = computeSolarReadiness(toSiteReadinessInput(study), level, { scheduleTaskCount })
```
In `…/(gated)/overview/page.tsx`, add the same count read to its `Promise.all` and pass `{ scheduleTaskCount }` as the third argument at line 35.

- [ ] **Step 4: Run — expect PASS**

```bash
pnpm --filter @esite/shared exec vitest run src/solar/readiness.test.ts
pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar"
```
Expected: PASS. `layout.test.tsx` / overview tests use `fakeSupabase`, whose `select` ignores its options and returns `data: []` — the count falls back to `0` (grey), so they stay green; if one asserts the exact readiness list, add the schedule row it now contains.

- [ ] **Step 5: Commit**

```bash
git add packages/shared/src/solar/readiness.ts packages/shared/src/solar/readiness.test.ts \
  "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/layout.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/overview/page.tsx"
git commit -m "feat(solar-schedule): Schedule tab enabled; readiness from the live task count

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 24: Toolbar — view controls, filters + DB presets, baselines, settings, export menu

**Files** (`…` = `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule`):
- Create: `…/FilterPopover.tsx`, `…/BaselineMenu.tsx`, `…/SettingsMenu.tsx`, `…/ExportMenu.tsx`, `…/ScheduleToolbar.tsx`
- Create: `…/ScheduleToolbar.test.tsx`

Spec §14.1 rows: View Day/Week/Month; Search with clear; Filters popover (status, owner, colour; Save as preset; preset list; clear all — **presets in the DB, per user**); Show Dependencies / Milestones / Split bars; Group by; Baselines (Save current — name + description; list; Compare); Import; Export (PNG, PDF, Excel, Word, calendar); `?`. Controls that need Edit are **not rendered** at View level. Colour filter options are the colours **in use** (WM offered 8 fixed ones, 12 of its 20 import colours were unfilterable).

- [ ] **Step 1: Write the failing test**

`apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleToolbar.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { createRef } from 'react'
import { ScheduleToolbar, type ScheduleToolbarProps } from './ScheduleToolbar'
import { EMPTY_SCHEDULE_FILTERS } from '@esite/shared'

function props(over: Partial<ScheduleToolbarProps> = {}): ScheduleToolbarProps {
  return {
    canEdit: true, zoom: 'week', onZoom: vi.fn(), search: '', onSearch: vi.fn(), filters: EMPTY_SCHEDULE_FILTERS, onFilters: vi.fn(),
    owners: [{ id: 'u1', name: 'Ann Smith', email: 'a@x' }], colours: ['#3b82f6', '#ef4444'],
    presets: [{ id: 'f1', name: 'Late', filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['in_progress'] } }],
    onApplyPreset: vi.fn(), onSavePreset: vi.fn(async () => null), onDeletePreset: vi.fn(),
    show: { links: true, milestones: true, split: true }, onShow: vi.fn(), groupBy: 'none', onGroupBy: vi.fn(),
    baselines: [{ id: 'b1', name: 'Contract', description: null, createdAt: '2026-09-01T10:00:00Z', durationMode: 'calendar' }],
    compareId: null, onCompare: vi.fn(), onSaveBaseline: vi.fn(async () => null), onDeleteBaseline: vi.fn(),
    settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null }, onSaveSettings: vi.fn(async () => null),
    canUndo: true, canRedo: false, onUndo: vi.fn(), onRedo: vi.fn(),
    onAddTask: vi.fn(), onAddMilestone: vi.fn(), onUseTemplate: vi.fn(), onImport: vi.fn(), onToday: vi.fn(), onShiftRange: vi.fn(), onHelp: vi.fn(),
    exportBase: '/api/projects/p1/solar/schedule/export', onExportPng: vi.fn(), searchRef: createRef<HTMLInputElement>(),
    ...over,
  }
}

describe('ScheduleToolbar', () => {
  it('View level sees view controls only', () => {
    render(<ScheduleToolbar {...props({ canEdit: false })} />)
    for (const name of ['Add task', 'Add milestone', 'Use template', 'Import', 'Undo', 'Redo', 'Schedule settings']) {
      expect(screen.queryByRole('button', { name })).toBeNull()
    }
    expect(screen.getByRole('button', { name: 'Week' })).toBeTruthy()
    expect(screen.getByRole('button', { name: /Export/ })).toBeTruthy()
  })
  it('zoom, search with clear, group by and show toggles report changes', () => {
    const p = props({ search: 'inst' })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Day' }))
    expect(p.onZoom).toHaveBeenCalledWith('day')
    fireEvent.change(screen.getByRole('searchbox', { name: 'Search tasks' }), { target: { value: 'design' } })
    expect(p.onSearch).toHaveBeenCalledWith('design')
    fireEvent.click(screen.getByRole('button', { name: 'Clear search' }))
    expect(p.onSearch).toHaveBeenCalledWith('')
    fireEvent.change(screen.getByLabelText('Group by'), { target: { value: 'category_zone' } })
    expect(p.onGroupBy).toHaveBeenCalledWith('category_zone')
    fireEvent.click(screen.getByRole('checkbox', { name: 'Dependencies' }))
    expect(p.onShow).toHaveBeenCalledWith({ links: false, milestones: true, split: true })
  })
  it('filters: colours in use, save a preset to the database, apply one', async () => {
    const p = props({ filters: { ...EMPTY_SCHEDULE_FILTERS, statuses: ['done'] } })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Filters (1)' }))
    expect(screen.getByRole('checkbox', { name: '#ef4444' })).toBeTruthy()
    fireEvent.click(screen.getByRole('checkbox', { name: 'Ann Smith' }))
    expect(p.onFilters).toHaveBeenCalledWith({ ...EMPTY_SCHEDULE_FILTERS, statuses: ['done'], ownerIds: ['u1'] })
    fireEvent.change(screen.getByLabelText('Preset name'), { target: { value: 'Done only' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save as preset' }))
    await waitFor(() => expect(p.onSavePreset).toHaveBeenCalledWith('Done only'))
    fireEvent.click(screen.getByRole('button', { name: 'Late' }))
    expect(p.onApplyPreset).toHaveBeenCalledWith('f1')
    fireEvent.click(screen.getByRole('button', { name: 'Clear all' }))
    expect(p.onFilters).toHaveBeenCalledWith(EMPTY_SCHEDULE_FILTERS)
  })
  it('baselines: save with a name, compare, and delete only after a second press', async () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Baselines' }))
    fireEvent.change(screen.getByLabelText('Baseline name'), { target: { value: 'Tender' } })
    fireEvent.change(screen.getByLabelText('Baseline description'), { target: { value: 'As tendered' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save current as baseline' }))
    await waitFor(() => expect(p.onSaveBaseline).toHaveBeenCalledWith('Tender', 'As tendered'))
    fireEvent.change(screen.getByLabelText('Compare with'), { target: { value: 'b1' } })
    expect(p.onCompare).toHaveBeenCalledWith('b1')
    fireEvent.click(screen.getByRole('button', { name: 'Delete baseline Contract' }))
    expect(p.onDeleteBaseline).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete Contract' }))
    expect(p.onDeleteBaseline).toHaveBeenCalledWith('b1')
  })
  it('export menu links to the server formats and exports PNG in the browser', () => {
    const p = props({ canEdit: false })
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: /Export/ }))
    expect(screen.getByRole('link', { name: 'PDF (A3 landscape)' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/pdf')
    expect(screen.getByRole('link', { name: 'Excel' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/xlsx')
    expect(screen.getByRole('link', { name: 'Word' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/docx')
    expect(screen.getByRole('link', { name: 'Calendar (.ics)' }).getAttribute('href')).toBe('/api/projects/p1/solar/schedule/export/ics')
    fireEvent.click(screen.getByRole('button', { name: 'Image (PNG)' }))
    expect(p.onExportPng).toHaveBeenCalled()
  })
  it('settings: working days and the workload limit', async () => {
    const p = props()
    render(<ScheduleToolbar {...p} />)
    fireEvent.click(screen.getByRole('button', { name: 'Schedule settings' }))
    fireEvent.click(screen.getByRole('radio', { name: 'Working days (weekends and SA public holidays excluded)' }))
    fireEvent.change(screen.getByLabelText('Flag an owner with more than this many tasks at once'), { target: { value: '3' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save settings' }))
    await waitFor(() => expect(p.onSaveSettings).toHaveBeenCalledWith('working', 3))
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleToolbar.test.tsx"`
Expected: FAIL — cannot resolve `./ScheduleToolbar`.

- [ ] **Step 3: Implement the pieces**

`…/FilterPopover.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { EMPTY_SCHEDULE_FILTERS, GANTT_STATUSES, GANTT_STATUS_LABELS, filterCount, type ScheduleFilters } from '@esite/shared'
import type { ScheduleOwner, SchedulePreset } from '@/lib/solar/schedule/types'

const toggle = <T,>(list: T[], v: T) => (list.includes(v) ? list.filter((x) => x !== v) : [...list, v])

export function FilterPopover({ filters, onFilters, owners, colours, presets, onApplyPreset, onSavePreset, onDeletePreset }: {
  filters: ScheduleFilters
  onFilters: (f: ScheduleFilters) => void
  owners: ScheduleOwner[]
  colours: string[]
  presets: SchedulePreset[]
  onApplyPreset: (id: string) => void
  onSavePreset: (name: string) => Promise<string | null>
  onDeletePreset: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const n = filterCount(filters)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>{n ? `Filters (${n})` : 'Filters'}</button>
      {open && (
        <div role="dialog" aria-label="Filters" style={{ position: 'absolute', zIndex: 20, top: '100%', left: 0, width: 280, padding: 12, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 12 }}>
          <fieldset><legend>Status</legend>
            {GANTT_STATUSES.map((s) => (
              <label key={s} style={{ display: 'block' }}>
                <input type="checkbox" checked={filters.statuses.includes(s)} onChange={() => onFilters({ ...filters, statuses: toggle(filters.statuses, s) })} /> {GANTT_STATUS_LABELS[s]}
              </label>
            ))}
          </fieldset>
          {owners.length > 0 && (
            <fieldset><legend>Owner</legend>
              {owners.map((o) => (
                <label key={o.id} style={{ display: 'block' }}>
                  <input type="checkbox" checked={filters.ownerIds.includes(o.id)} onChange={() => onFilters({ ...filters, ownerIds: toggle(filters.ownerIds, o.id) })} /> {o.name}
                </label>
              ))}
            </fieldset>
          )}
          {colours.length > 0 && (
            <fieldset><legend>Colour</legend>
              {colours.map((c) => (
                <label key={c} style={{ display: 'inline-flex', alignItems: 'center', gap: 4, marginRight: 8 }}>
                  <input type="checkbox" aria-label={c} checked={filters.colours.includes(c)} onChange={() => onFilters({ ...filters, colours: toggle(filters.colours, c) })} />
                  <span style={{ width: 12, height: 12, background: c, display: 'inline-block', borderRadius: 2 }} />
                </label>
              ))}
            </fieldset>
          )}
          <button type="button" onClick={() => onFilters(EMPTY_SCHEDULE_FILTERS)}>Clear all</button>
          <div style={{ marginTop: 8, borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
            <div style={{ fontWeight: 600 }}>My presets</div>
            {presets.length === 0 && <div style={{ color: 'var(--c-text-dim)' }}>No saved presets yet.</div>}
            {presets.map((p) => (
              <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between' }}>
                <button type="button" onClick={() => onApplyPreset(p.id)}>{p.name}</button>
                <button type="button" aria-label={`Delete preset ${p.name}`} onClick={() => onDeletePreset(p.id)}>×</button>
              </div>
            ))}
            <label style={{ display: 'block', marginTop: 6 }}>Preset name <input value={name} maxLength={80} onChange={(e) => setName(e.target.value)} /></label>
            <button type="button" disabled={!name.trim()} onClick={async () => {
              const err = await onSavePreset(name.trim())
              setMsg(err ?? 'Preset saved.')
              if (!err) setName('')
            }}>Save as preset</button>
            {msg && <div role="status">{msg}</div>}
          </div>
        </div>
      )}
    </div>
  )
}
```

`…/BaselineMenu.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import type { ScheduleBaselineSummary } from '@/lib/solar/schedule/types'

function BaselineRow({ b, canEdit, onDelete }: { b: ScheduleBaselineSummary; canEdit: boolean; onDelete: (id: string) => void }) {
  const { armed, arm, disarm } = useArmedConfirm()
  return (
    <li style={{ display: 'flex', justifyContent: 'space-between', gap: 8 }}>
      <span title={b.description ?? undefined}>{b.name} <span style={{ color: 'var(--c-text-dim)' }}>{b.createdAt.slice(0, 10)}</span></span>
      {canEdit && (armed
        ? <button type="button" aria-label={`Confirm delete ${b.name}`} onClick={() => { disarm(); onDelete(b.id) }}>Delete?</button>
        : <button type="button" aria-label={`Delete baseline ${b.name}`} onClick={arm}>×</button>)}
    </li>
  )
}

export function BaselineMenu({ canEdit, baselines, compareId, onCompare, onSave, onDelete }: {
  canEdit: boolean
  baselines: ScheduleBaselineSummary[]
  compareId: string | null
  onCompare: (id: string | null) => void
  onSave: (name: string, description: string) => Promise<string | null>
  onDelete: (id: string) => void
}) {
  const [open, setOpen] = useState(false)
  const [name, setName] = useState('')
  const [desc, setDesc] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Baselines</button>
      {open && (
        <div role="dialog" aria-label="Baselines" style={{ position: 'absolute', zIndex: 20, top: '100%', right: 0, width: 300, padding: 12, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 12 }}>
          <label style={{ display: 'block' }}>Compare with{' '}
            <select aria-label="Compare with" value={compareId ?? ''} onChange={(e) => onCompare(e.target.value || null)}>
              <option value="">No comparison</option>
              {baselines.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
            </select>
          </label>
          <ul style={{ listStyle: 'none', padding: 0 }}>
            {baselines.map((b) => <BaselineRow key={b.id} b={b} canEdit={canEdit} onDelete={onDelete} />)}
          </ul>
          {canEdit && (
            <div style={{ borderTop: '1px solid var(--c-border)', paddingTop: 8 }}>
              <label style={{ display: 'block' }}>Baseline name <input value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></label>
              <label style={{ display: 'block' }}>Baseline description <input value={desc} maxLength={1000} onChange={(e) => setDesc(e.target.value)} /></label>
              <button type="button" disabled={!name.trim()} onClick={async () => {
                const err = await onSave(name.trim(), desc.trim())
                setMsg(err ?? 'Baseline saved.')
                if (!err) { setName(''); setDesc('') }
              }}>Save current as baseline</button>
            </div>
          )}
          {msg && <div role="status">{msg}</div>}
        </div>
      )}
    </div>
  )
}
```

`…/SettingsMenu.tsx`:
```tsx
'use client'
import { useState } from 'react'
import type { DurationMode } from '@esite/shared'
import type { ScheduleSettingsView } from '@/lib/solar/schedule/types'

export function SettingsMenu({ settings, onSave }: {
  settings: ScheduleSettingsView
  onSave: (mode: DurationMode, threshold: number) => Promise<string | null>
}) {
  const [open, setOpen] = useState(false)
  const [mode, setMode] = useState<DurationMode>(settings.durationMode)
  const [threshold, setThreshold] = useState(String(settings.workloadThreshold))
  const [msg, setMsg] = useState<string | null>(null)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Schedule settings</button>
      {open && (
        <div role="dialog" aria-label="Schedule settings" style={{ position: 'absolute', zIndex: 20, top: '100%', right: 0, width: 320, padding: 12, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 12 }}>
          <fieldset><legend>Count durations in</legend>
            <label style={{ display: 'block' }}><input type="radio" name="mode" checked={mode === 'calendar'} onChange={() => setMode('calendar')} /> Calendar days</label>
            <label style={{ display: 'block' }}><input type="radio" name="mode" checked={mode === 'working'} onChange={() => setMode('working')} /> Working days (weekends and SA public holidays excluded)</label>
          </fieldset>
          <label style={{ display: 'block', marginTop: 8 }}>Flag an owner with more than this many tasks at once
            <input type="number" min={1} max={50} value={threshold} onChange={(e) => setThreshold(e.target.value)} style={{ width: 60, marginLeft: 6 }} />
          </label>
          <button type="button" onClick={async () => setMsg((await onSave(mode, Number(threshold))) ?? 'Settings saved.')}>Save settings</button>
          {msg && <div role="status">{msg}</div>}
        </div>
      )}
    </div>
  )
}
```

`…/ExportMenu.tsx`:
```tsx
'use client'
import { useState } from 'react'

const FORMATS = [['pdf', 'PDF (A3 landscape)'], ['xlsx', 'Excel'], ['docx', 'Word'], ['ics', 'Calendar (.ics)']] as const

export function ExportMenu({ exportBase, onExportPng }: { exportBase: string; onExportPng: () => void }) {
  const [open, setOpen] = useState(false)
  return (
    <div style={{ position: 'relative' }}>
      <button type="button" aria-expanded={open} onClick={() => setOpen((o) => !o)}>Export ▾</button>
      {open && (
        <div role="menu" style={{ position: 'absolute', zIndex: 20, top: '100%', right: 0, width: 200, padding: 8, background: 'var(--c-surface)', border: '1px solid var(--c-border)', borderRadius: 6, fontSize: 12, display: 'grid', gap: 4 }}>
          <button type="button" onClick={() => { setOpen(false); onExportPng() }}>Image (PNG)</button>
          {FORMATS.map(([f, label]) => <a key={f} href={`${exportBase}/${f}`} download>{label}</a>)}
        </div>
      )}
    </div>
  )
}
```
If the owner declines DOCX (open question 7), drop the `['docx', 'Word']` entry and the Word assertion in the test.

`…/ScheduleToolbar.tsx`:
```tsx
'use client'
/** Schedule header and toolbar (spec §14.1). Edit controls are not rendered below Edit. */
import type { RefObject } from 'react'
import {
  SCHEDULE_GROUP_BYS, SCHEDULE_GROUP_BY_LABELS, SCHEDULE_ZOOMS,
  type DurationMode, type ScheduleFilters, type ScheduleGroupBy, type ScheduleZoom,
} from '@esite/shared'
import type { ScheduleBaselineSummary, ScheduleOwner, SchedulePreset, ScheduleSettingsView } from '@/lib/solar/schedule/types'
import { FilterPopover } from './FilterPopover'
import { BaselineMenu } from './BaselineMenu'
import { SettingsMenu } from './SettingsMenu'
import { ExportMenu } from './ExportMenu'

export interface ScheduleShow { links: boolean; milestones: boolean; split: boolean }

export interface ScheduleToolbarProps {
  canEdit: boolean
  zoom: ScheduleZoom
  onZoom: (z: ScheduleZoom) => void
  search: string
  onSearch: (s: string) => void
  filters: ScheduleFilters
  onFilters: (f: ScheduleFilters) => void
  owners: ScheduleOwner[]
  colours: string[]
  presets: SchedulePreset[]
  onApplyPreset: (id: string) => void
  onSavePreset: (name: string) => Promise<string | null>
  onDeletePreset: (id: string) => void
  show: ScheduleShow
  onShow: (s: ScheduleShow) => void
  groupBy: ScheduleGroupBy
  onGroupBy: (g: ScheduleGroupBy) => void
  baselines: ScheduleBaselineSummary[]
  compareId: string | null
  onCompare: (id: string | null) => void
  onSaveBaseline: (name: string, description: string) => Promise<string | null>
  onDeleteBaseline: (id: string) => void
  settings: ScheduleSettingsView
  onSaveSettings: (mode: DurationMode, threshold: number) => Promise<string | null>
  canUndo: boolean
  canRedo: boolean
  onUndo: () => void
  onRedo: () => void
  onAddTask: () => void
  onAddMilestone: () => void
  onUseTemplate: () => void
  onImport: () => void
  onToday: () => void
  onShiftRange: (dir: -1 | 1) => void
  onHelp: () => void
  exportBase: string
  onExportPng: () => void
  searchRef: RefObject<HTMLInputElement | null>
}

const ZOOM_LABEL: Record<ScheduleZoom, string> = { day: 'Day', week: 'Week', month: 'Month' }

export function ScheduleToolbar(p: ScheduleToolbarProps) {
  return (
    <div role="toolbar" aria-label="Schedule" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', fontSize: 12 }}>
      {p.canEdit && (
        <>
          <button type="button" className="btn-primary" onClick={p.onAddTask}>Add task</button>
          <button type="button" onClick={p.onAddMilestone}>Add milestone</button>
          <button type="button" onClick={p.onUseTemplate}>Use template</button>
          <button type="button" onClick={p.onImport}>Import</button>
          <button type="button" disabled={!p.canUndo} onClick={p.onUndo}>Undo</button>
          <button type="button" disabled={!p.canRedo} onClick={p.onRedo}>Redo</button>
        </>
      )}
      <div role="group" aria-label="Time scale" style={{ display: 'inline-flex' }}>
        {SCHEDULE_ZOOMS.map((z) => (
          <button key={z} type="button" aria-pressed={p.zoom === z} onClick={() => p.onZoom(z)}>{ZOOM_LABEL[z]}</button>
        ))}
      </div>
      <button type="button" aria-label="Earlier" onClick={() => p.onShiftRange(-1)}>‹</button>
      <button type="button" onClick={p.onToday}>Today</button>
      <button type="button" aria-label="Later" onClick={() => p.onShiftRange(1)}>›</button>
      <span style={{ display: 'inline-flex', alignItems: 'center' }}>
        <input ref={p.searchRef} type="search" aria-label="Search tasks" placeholder="Search tasks…" value={p.search} onChange={(e) => p.onSearch(e.target.value)} />
        {p.search && <button type="button" aria-label="Clear search" onClick={() => p.onSearch('')}>×</button>}
      </span>
      <FilterPopover filters={p.filters} onFilters={p.onFilters} owners={p.owners} colours={p.colours} presets={p.presets}
        onApplyPreset={p.onApplyPreset} onSavePreset={p.onSavePreset} onDeletePreset={p.onDeletePreset} />
      {(['links', 'milestones', 'split'] as const).map((k) => (
        <label key={k}>
          <input type="checkbox" checked={p.show[k]} onChange={() => p.onShow({ ...p.show, [k]: !p.show[k] })} />{' '}
          {k === 'links' ? 'Dependencies' : k === 'milestones' ? 'Milestones' : 'Split bars'}
        </label>
      ))}
      <label>Group by{' '}
        <select aria-label="Group by" value={p.groupBy} onChange={(e) => p.onGroupBy(e.target.value as ScheduleGroupBy)}>
          {SCHEDULE_GROUP_BYS.map((g) => <option key={g} value={g}>{SCHEDULE_GROUP_BY_LABELS[g]}</option>)}
        </select>
      </label>
      <BaselineMenu canEdit={p.canEdit} baselines={p.baselines} compareId={p.compareId} onCompare={p.onCompare}
        onSave={p.onSaveBaseline} onDelete={p.onDeleteBaseline} />
      <ExportMenu exportBase={p.exportBase} onExportPng={p.onExportPng} />
      {p.canEdit && <SettingsMenu settings={p.settings} onSave={p.onSaveSettings} />}
      <button type="button" aria-label="Keyboard shortcuts" onClick={p.onHelp}>?</button>
    </div>
  )
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleToolbar.test.tsx"`
Expected: PASS (6 tests). (The two `<select>`s carry their own `aria-label`: a label that wraps a select also contains the option texts, so it would not match by label text.)

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule"
git commit -m "feat(solar-schedule): toolbar — zoom, search, DB-backed filter presets, baselines, settings, export menu

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 25: Row list (DOM) and the timeline (Konva)

**Files** (`…` = `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule`):
- Create: `…/ScheduleRowList.tsx`, `…/ScheduleRowList.test.tsx`
- Create: `…/GanttCanvas.tsx`

Both render the same `ScheduleRow[]` at the same `GANTT_HEADER_HEIGHT` / `GANTT_ROW_HEIGHT`, inside one vertically scrolling container (Task 29), so a name always sits beside its bar — including group headers (fixes WM D4). The list is DOM (checkboxes, drag handles, keyboard focus, testable); the chart is Konva, drawn from `layoutGantt()` only.

Interactions (spec §14.2): row checkbox, progress badge, drag handle → reorder of the **full** list; bar drag/resize snapping to days (one undo step per drag); split-bar segments dragged individually; dependency drag from a bar's end handle to another bar; today line; weekend/holiday shading. Konva lessons from #190: select on **mousedown**, not click; `toDataURL` for the PNG.

- [ ] **Step 1: Write the failing test (row list)**

`…/ScheduleRowList.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { ScheduleRowList } from './ScheduleRowList'
import { buildScheduleRows, GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type ScheduleTaskView } from '@esite/shared'

const t = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-02',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, progress: 40, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
  sortOrder: Number(id), description: '', updatedAt: 'U', segments: [], ...over,
})
const dt = () => {
  const store: Record<string, string> = {}
  return { setData: (k: string, v: string) => { store[k] = v }, getData: (k: string) => store[k], effectAllowed: '', dropEffect: '' }
}

describe('ScheduleRowList', () => {
  const rows = buildScheduleRows([t('1'), t('2', { awaitingSignOff: true, status: 'done' }), t('3', { category: 'Install' })], 'category', new Set())
  it('renders headers and tasks at the chart’s row height, with progress and sign-off badges', () => {
    const { container } = render(<ScheduleRowList rows={rows} canEdit selected={new Set()} onToggleSelect={vi.fn()} onToggleGroup={vi.fn()} onOpenTask={vi.fn()} onReorder={vi.fn()} />)
    expect((container.firstChild as HTMLElement).firstChild).toHaveProperty('style.height', `${GANTT_HEADER_HEIGHT}px`)
    const items = screen.getAllByRole('listitem')
    expect(items).toHaveLength(5)
    for (const li of items) expect(li.style.height).toBe(`${GANTT_ROW_HEIGHT}px`)
    expect(screen.getAllByText('40%')).toHaveLength(2) // tasks 1 and 3; task 2 is done → 100%
    expect(screen.getByText('100%')).toBeTruthy()
    expect(screen.getByText('Awaiting sign-off')).toBeTruthy()
  })
  it('group headers collapse; task names open the dialog; checkboxes select', () => {
    const onToggleGroup = vi.fn()
    const onOpenTask = vi.fn()
    const onToggleSelect = vi.fn()
    render(<ScheduleRowList rows={rows} canEdit selected={new Set(['1'])} onToggleSelect={onToggleSelect} onToggleGroup={onToggleGroup} onOpenTask={onOpenTask} onReorder={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Collapse Design (2)' }))
    expect(onToggleGroup).toHaveBeenCalledWith('category:Design')
    fireEvent.click(screen.getByRole('button', { name: 'SOLAR-3 Task 3' }))
    expect(onOpenTask).toHaveBeenCalledWith('3')
    expect((screen.getByRole('checkbox', { name: 'Select SOLAR-1' }) as HTMLInputElement).checked).toBe(true)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-2' }))
    expect(onToggleSelect).toHaveBeenCalledWith('2')
  })
  it('dragging a selected row moves the whole selection before the drop target', () => {
    const onReorder = vi.fn()
    render(<ScheduleRowList rows={buildScheduleRows([t('1'), t('2'), t('3')], 'none', new Set())} canEdit selected={new Set(['1', '2'])}
      onToggleSelect={vi.fn()} onToggleGroup={vi.fn()} onOpenTask={vi.fn()} onReorder={onReorder} />)
    const transfer = dt()
    fireEvent.dragStart(screen.getAllByRole('button', { name: 'Drag to reorder' })[0], { dataTransfer: transfer })
    fireEvent.drop(screen.getAllByRole('listitem')[2], { dataTransfer: transfer })
    expect(onReorder).toHaveBeenCalledWith(['1', '2'], '3')
  })
  it('View level: no checkboxes and no drag handles', () => {
    render(<ScheduleRowList rows={rows} canEdit={false} selected={new Set()} onToggleSelect={vi.fn()} onToggleGroup={vi.fn()} onOpenTask={vi.fn()} onReorder={vi.fn()} />)
    expect(screen.queryAllByRole('checkbox')).toHaveLength(0)
    expect(screen.queryAllByRole('button', { name: 'Drag to reorder' })).toHaveLength(0)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleRowList.test.tsx"`
Expected: FAIL — cannot resolve `./ScheduleRowList`.

- [ ] **Step 3: Implement the row list**

`…/ScheduleRowList.tsx`:
```tsx
'use client'
import { GANTT_HEADER_HEIGHT, GANTT_ROW_HEIGHT, type ScheduleRow } from '@esite/shared'

export function ScheduleRowList({ rows, canEdit, selected, onToggleSelect, onToggleGroup, onOpenTask, onReorder }: {
  rows: ScheduleRow[]
  canEdit: boolean
  selected: ReadonlySet<string>
  onToggleSelect: (id: string) => void
  onToggleGroup: (key: string) => void
  onOpenTask: (id: string) => void
  onReorder: (movedIds: string[], beforeId: string | null) => void
}) {
  return (
    <div style={{ width: 340, flex: '0 0 340px', borderRight: '1px solid var(--c-border)', fontSize: 12 }}>
      <div style={{ height: GANTT_HEADER_HEIGHT, borderBottom: '1px solid var(--c-border)', display: 'flex', alignItems: 'flex-end', padding: '0 8px 4px', color: 'var(--c-text-dim)' }}>Task</div>
      <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}
        onDragOver={(e) => { if (canEdit) e.preventDefault() }}>
        {rows.map((r) => {
          if (r.kind === 'group') {
            return (
              <li key={r.key} style={{ height: GANTT_ROW_HEIGHT, display: 'flex', alignItems: 'center', paddingLeft: 8 + r.depth * 14, background: 'var(--c-surface-2, #f3f4f6)', fontWeight: 600 }}>
                <button type="button" aria-label={`${r.collapsed ? 'Expand' : 'Collapse'} ${r.label} (${r.count})`} onClick={() => onToggleGroup(r.key)}>
                  {r.collapsed ? '▸' : '▾'} {r.label} ({r.count})
                </button>
              </li>
            )
          }
          const t = r.task
          return (
            <li key={t.id} style={{ height: GANTT_ROW_HEIGHT, display: 'flex', alignItems: 'center', gap: 6, paddingLeft: 8 + r.depth * 14, borderBottom: '1px solid var(--c-border)' }}
              onDrop={(e) => {
                if (!canEdit) return
                e.preventDefault()
                const dragged = e.dataTransfer.getData('text/plain')
                if (!dragged) return
                const moved = selected.has(dragged) ? [...selected] : [dragged]
                onReorder(moved, t.id)
              }}>
              {canEdit && (
                <>
                  <span role="button" tabIndex={0} aria-label="Drag to reorder" draggable style={{ cursor: 'grab', color: 'var(--c-text-dim)' }}
                    onDragStart={(e) => { e.dataTransfer.setData('text/plain', t.id); e.dataTransfer.effectAllowed = 'move' }}>⋮⋮</span>
                  <input type="checkbox" aria-label={`Select ${t.ref}`} checked={selected.has(t.id)} onChange={() => onToggleSelect(t.id)} />
                </>
              )}
              <span style={{ width: 8, height: 8, borderRadius: t.isMilestone ? 0 : 2, transform: t.isMilestone ? 'rotate(45deg)' : undefined, background: t.colour, flex: '0 0 8px' }} />
              <button type="button" aria-label={`${t.ref} ${t.name}`} onClick={() => onOpenTask(t.id)}
                style={{ flex: 1, textAlign: 'left', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', background: 'none', border: 0, padding: 0 }}>
                <span style={{ color: 'var(--c-text-dim)' }}>{t.ref}</span> {t.name}
              </button>
              {t.awaitingSignOff && <span style={{ fontSize: 10, color: 'var(--c-amber)' }}>Awaiting sign-off</span>}
              {!t.isMilestone && <span style={{ fontSize: 10, minWidth: 30, textAlign: 'right' }}>{t.status === 'done' ? 100 : t.progress}%</span>}
            </li>
          )
        })}
      </ul>
    </div>
  )
}
```

- [ ] **Step 4: Implement the Konva timeline**

`…/GanttCanvas.tsx`:
```tsx
'use client'
/**
 * The Gantt timeline (Konva). Draws ONLY what layoutGantt() returns; all
 * interaction is reported through callbacks in whole days. No component test
 * (Konva does not render under jsdom) — geometry is tested in @esite/shared,
 * behaviour through ScheduleClient's test with a stub of this component.
 */
import { forwardRef, useImperativeHandle, useRef, useState } from 'react'
import { Circle, Group, Layer, Line, Rect, RegularPolygon, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { GANTT_HEADER_HEIGHT, type GanttBar, type GanttLayout } from '@esite/shared'

export interface GanttCanvasHandle {
  exportPng: () => string | null
  scrollToX: (x: number) => void
  scrollBy: (dx: number) => void
}

export type BarDragKind = 'move' | 'start' | 'end' | 'segment'

export interface GanttCanvasProps {
  layout: GanttLayout
  canEdit: boolean
  selected: ReadonlySet<string>
  onBarDrag: (taskId: string, kind: BarDragKind, deltaDays: number, segmentIndex: number | null) => void
  onLinkDraw: (predecessorId: string, successorId: string) => void
  onSelect: (taskId: string, additive: boolean) => void
  onOpenTask: (taskId: string) => void
  onOpenLink: (linkKey: string) => void
}

const HANDLE = 6
const SHADE = { weekend: '#f3f4f6', holiday: '#fde68a' }

type Drag = { bar: GanttBar; kind: BarDragKind; x0: number; dx: number }

function barAt(bars: GanttBar[], x: number, y: number): GanttBar | null {
  return bars.find((b) => y >= b.y && y <= b.y + b.h && (b.kind === 'milestone' ? Math.abs(x - b.x) <= 7 : x >= b.x && x <= b.x + b.w)) ?? null
}

export const GanttCanvas = forwardRef<GanttCanvasHandle, GanttCanvasProps>(function GanttCanvas(p, ref) {
  const stageRef = useRef<Konva.Stage>(null)
  const scrollRef = useRef<HTMLDivElement>(null)
  const [drag, setDrag] = useState<Drag | null>(null)
  const [draft, setDraft] = useState<{ from: GanttBar; x1: number; y1: number; x2: number; y2: number } | null>(null)
  const l = p.layout

  useImperativeHandle(ref, () => ({
    exportPng: () => stageRef.current?.toDataURL({ pixelRatio: l.width > 8000 ? 1 : 2, mimeType: 'image/png' }) ?? null,
    scrollToX: (x: number) => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, x - 200) },
    scrollBy: (dx: number) => { if (scrollRef.current) scrollRef.current.scrollLeft = Math.max(0, scrollRef.current.scrollLeft + dx) },
  }), [l.width])

  const pointer = () => stageRef.current?.getPointerPosition() ?? { x: 0, y: 0 }
  const startDrag = (bar: GanttBar, kind: BarDragKind) => { if (p.canEdit) setDrag({ bar, kind, x0: pointer().x, dx: 0 }) }
  const offsetFor = (b: GanttBar) => {
    if (!drag || drag.bar.taskId !== b.taskId) return { x: 0, w: 0 }
    const d = Math.round(drag.dx / l.dayWidth) * l.dayWidth
    if (drag.kind === 'segment') return drag.bar.segmentIndex === b.segmentIndex ? { x: d, w: 0 } : { x: 0, w: 0 }
    if (drag.kind === 'move') return { x: d, w: 0 }
    if (drag.kind === 'start') return { x: Math.min(d, b.w - l.dayWidth), w: -Math.min(d, b.w - l.dayWidth) }
    return { x: 0, w: Math.max(d, -(b.w - l.dayWidth)) }
  }

  return (
    <div ref={scrollRef} style={{ overflowX: 'auto', overflowY: 'hidden', flex: 1 }}>
      <Stage
        ref={stageRef}
        width={l.width}
        height={l.height}
        onMouseMove={() => {
          const pt = pointer()
          if (drag) setDrag({ ...drag, dx: pt.x - drag.x0 })
          if (draft) setDraft({ ...draft, x2: pt.x, y2: pt.y })
        }}
        onMouseUp={() => {
          const pt = pointer()
          if (drag) {
            const delta = Math.round(drag.dx / l.dayWidth)
            if (delta !== 0) p.onBarDrag(drag.bar.taskId, drag.kind, delta, drag.bar.segmentIndex)
            setDrag(null)
          }
          if (draft) {
            const target = barAt(l.bars, pt.x, pt.y)
            if (target && target.taskId !== draft.from.taskId) p.onLinkDraw(draft.from.taskId, target.taskId)
            setDraft(null)
          }
        }}
      >
        <Layer listening={false}>
          <Rect x={0} y={0} width={l.width} height={l.height} fill="#ffffff" />
          {l.shades.map((s) => <Rect key={`${s.kind}${s.x}`} x={s.x} y={0} width={s.w} height={l.height} fill={SHADE[s.kind]} opacity={0.6} />)}
          <Rect x={0} y={0} width={l.width} height={GANTT_HEADER_HEIGHT} fill="#fafafa" />
          {l.ticks.map((t) => (
            <Group key={`t${t.x}`}>
              <Line points={[t.x, GANTT_HEADER_HEIGHT - 10, t.x, l.height]} stroke={t.major ? '#d1d5db' : '#eeeeee'} strokeWidth={1} />
              <Text x={t.x + 3} y={GANTT_HEADER_HEIGHT - 22} text={t.label} fontSize={10} fill="#374151" />
            </Group>
          ))}
          {l.todayX !== null && <Line points={[l.todayX, 0, l.todayX, l.height]} stroke="#ef4444" strokeWidth={1.5} dash={[4, 3]} />}
          {l.baselineBars.map((b) => <Rect key={`bl${b.taskId}`} x={b.x} y={b.y} width={b.w} height={3} fill="#9ca3af" />)}
        </Layer>
        <Layer>
          {l.links.map((k) => (
            <Line key={k.key} points={k.points} stroke={k.critical ? '#dc2626' : '#6b7280'} strokeWidth={k.critical ? 2 : 1.25}
              hitStrokeWidth={8} onMouseDown={() => p.onOpenLink(k.key)} />
          ))}
          {l.bars.map((b) => {
            const off = offsetFor(b)
            const sel = p.selected.has(b.taskId)
            const stroke = b.critical ? '#dc2626' : sel ? '#111827' : undefined
            if (b.kind === 'milestone') {
              return (
                <RegularPolygon key={`m${b.taskId}`} x={b.x + off.x} y={b.y + b.h / 2} sides={4} radius={7} fill={b.critical ? '#dc2626' : '#111827'}
                  stroke={sel ? '#f59e0b' : undefined} strokeWidth={2}
                  onMouseDown={(e) => { p.onSelect(b.taskId, e.evt.shiftKey); startDrag(b, 'move') }}
                  onDblClick={() => p.onOpenTask(b.taskId)} />
              )
            }
            const kind: BarDragKind = b.kind === 'segment' ? 'segment' : 'move'
            return (
              <Group key={`b${b.taskId}${b.segmentIndex ?? ''}`}>
                <Rect x={b.x + off.x} y={b.y} width={Math.max(2, b.w + off.w)} height={b.h} fill={b.colour} cornerRadius={3}
                  stroke={stroke} strokeWidth={stroke ? 2 : 0}
                  onMouseDown={(e) => { p.onSelect(b.taskId, e.evt.shiftKey); startDrag(b, kind) }}
                  onDblClick={() => p.onOpenTask(b.taskId)} />
                <Rect x={b.x + off.x} y={b.y + b.h - 3} width={Math.max(0, (b.w + off.w) * (b.progress / 100))} height={3} fill="#00000055" listening={false} />
                {p.canEdit && b.kind === 'task' && (
                  <>
                    <Rect x={b.x + off.x} y={b.y} width={HANDLE} height={b.h} fill="#00000000" onMouseDown={(e) => { e.cancelBubble = true; startDrag(b, 'start') }} />
                    <Rect x={b.x + off.x + b.w + off.w - HANDLE} y={b.y} width={HANDLE} height={b.h} fill="#00000000" onMouseDown={(e) => { e.cancelBubble = true; startDrag(b, 'end') }} />
                    <Circle x={b.x + off.x + b.w + off.w + 6} y={b.y + b.h / 2} radius={4} fill="#ffffff" stroke="#6b7280"
                      onMouseDown={(e) => { e.cancelBubble = true; const pt = pointer(); setDraft({ from: b, x1: pt.x, y1: pt.y, x2: pt.x, y2: pt.y }) }} />
                  </>
                )}
              </Group>
            )
          })}
          {draft && <Line points={[draft.x1, draft.y1, draft.x2, draft.y2]} stroke="#2563eb" dash={[4, 4]} listening={false} />}
        </Layer>
      </Stage>
    </div>
  )
})
```

- [ ] **Step 5: Run — expect PASS; type-check the canvas**

```bash
pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleRowList.test.tsx"
pnpm --filter web type-check
```
Expected: PASS; type-check exit 0 (the canvas is only type-checked here; it is exercised by hand in Task 30's walk).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleRowList.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleRowList.test.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/GanttCanvas.tsx"
git commit -m "feat(solar-schedule): aligned DOM row list + Konva timeline (drag, resize, segments, link drawing)

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 26: Task / milestone dialog and link dialog

**Files** (`…` = `apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule`):
- Create: `…/TaskDialog.tsx`, `…/TaskDialog.test.tsx`, `…/LinkDialog.tsx`, `…/LinkDialog.test.tsx`

Spec §14.1: task fields name, category, zone, start, end **or duration**, owner (project member), status, progress, colour, notes; milestone name, date, colour, description — **editable after creation** (WM could not). Split bars are edited here too (split at a date, move a segment's dates, join) — WM's segments could not be edited at all (D6). Link dialog: FS/SS/FF/SF + lag, edit and remove (WM could do neither). Dates go from `<input type="date">` to the payload as strings; the test runs in SAST and asserts no drift.

- [ ] **Step 1: Write the failing tests**

`…/TaskDialog.test.tsx`:
```tsx
process.env.TZ = 'Africa/Johannesburg'
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import { TaskDialog } from './TaskDialog'
import { makeWorkCalendar, saHolidaySet, type ScheduleTaskView } from '@esite/shared'

const owners = [{ id: 'u1', name: 'Ann Smith', email: 'a@x' }, { id: 'u2', name: 'Bob Dube', email: 'b@x' }]
const cal = makeWorkCalendar('calendar')
const existing: ScheduleTaskView = {
  id: 't1', workItemId: 'w1', ref: 'SOLAR-1', name: 'Design', category: 'Design', zone: '', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, progress: 40, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann Smith',
  sortOrder: 1, description: '', updatedAt: 'U1', segments: [],
}
const base = { owners, cal, canEdit: true, defaultStart: '2026-09-28', onClose: vi.fn() }

describe('TaskDialog', () => {
  it('creates a task; the typed dates reach the payload unchanged in SAST', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'Install mounting' } })
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-01' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('Owner'), { target: { value: 'u2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ input: {
      key: 'new', name: 'Install mounting', start: '2026-10-01', end: '2026-10-05', isMilestone: false, category: '', zone: '',
      ownerId: 'u2', status: 'not_started', progress: 0, colour: '#3b82f6', description: '',
    } }))
  })
  it('duration mode counts working days over Heritage Day and the weekend', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} cal={makeWorkCalendar('working', saHolidaySet(2026, 2026))} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'X' } })
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-09-23' } })
    fireEvent.click(screen.getByRole('radio', { name: 'Duration' }))
    fireEvent.change(screen.getByLabelText('Duration (days)'), { target: { value: '3' } })
    expect(screen.getByText('Ends 28 Sep 2026')).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ input: expect.objectContaining({ start: '2026-09-23', end: '2026-09-28' }) }))
  })
  it('refuses an end before the start and a blank name, without submitting', () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={null} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Start'), { target: { value: '2026-10-05' } })
    fireEvent.change(screen.getByLabelText('End'), { target: { value: '2026-10-01' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    expect(screen.getByText('Give the task a name.')).toBeTruthy()
    expect(screen.getByText('The end date is before the start date.')).toBeTruthy()
    expect(onSubmit).not.toHaveBeenCalled()
  })
  it('editing sends only what changed, with the concurrency token', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Progress %'), { target: { value: '60' } })
    fireEvent.change(screen.getByLabelText('Status'), { target: { value: 'done' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1', progress: 60, status: 'done' } }))
  })
  it('a milestone has one date and stays editable', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="milestone" initial={{ ...existing, isMilestone: true, end: '2026-10-01' }} onSubmit={onSubmit} />)
    expect(screen.queryByLabelText('End')).toBeNull()
    fireEvent.change(screen.getByLabelText('Date'), { target: { value: '2026-10-09' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1', start: '2026-10-09', end: '2026-10-09' } }))
  })
  it('splits a task at a date and joins it again', async () => {
    const onSubmit = vi.fn(async () => null)
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={onSubmit} />)
    fireEvent.change(screen.getByLabelText('Split at'), { target: { value: '2026-10-03' } })
    fireEvent.click(screen.getByRole('button', { name: 'Split' }))
    expect(screen.getAllByLabelText(/Segment \d start/)).toHaveLength(2)
    fireEvent.change(screen.getByLabelText('Segment 2 start'), { target: { value: '2026-10-04' } })
    fireEvent.change(screen.getByLabelText('Segment 2 end'), { target: { value: '2026-10-06' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save' }))
    await waitFor(() => expect(onSubmit).toHaveBeenCalledWith({ patch: { id: 't1', expectedUpdatedAt: 'U1',
      segments: [{ start: '2026-10-01', end: '2026-10-02' }, { start: '2026-10-04', end: '2026-10-06' }] } }))
  })
  it('View level: read-only, no Save', () => {
    render(<TaskDialog {...base} canEdit={false} mode="task" initial={existing} onSubmit={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save' })).toBeNull()
    expect((screen.getByLabelText('Name') as HTMLInputElement).disabled).toBe(true)
  })
  it('delete needs a second press', () => {
    const onDelete = vi.fn()
    render(<TaskDialog {...base} mode="task" initial={existing} onSubmit={vi.fn()} onDelete={onDelete} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete task' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm delete' }))
    expect(onDelete).toHaveBeenCalledWith('t1')
  })
})
```

`…/LinkDialog.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { LinkDialog } from './LinkDialog'

describe('LinkDialog', () => {
  it('edits type and lag', () => {
    const onSave = vi.fn()
    render(<LinkDialog title="Design → Install" initialType="FS" initialLag={0} canEdit isNew={false} onSave={onSave} onRemove={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'SS' } })
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '2' } })
    fireEvent.click(screen.getByRole('button', { name: 'Save link' }))
    expect(onSave).toHaveBeenCalledWith('SS', 2)
  })
  it('refuses a lag beyond a year', () => {
    const onSave = vi.fn()
    render(<LinkDialog title="A → B" initialType="FS" initialLag={0} canEdit isNew onSave={onSave} onRemove={vi.fn()} onClose={vi.fn()} />)
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '400' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    expect(screen.getByText('Lag must be a whole number of days between -365 and 365.')).toBeTruthy()
    expect(onSave).not.toHaveBeenCalled()
  })
  it('remove needs a second press; View level sees no controls', () => {
    const onRemove = vi.fn()
    const { unmount } = render(<LinkDialog title="A → B" initialType="FF" initialLag={1} canEdit isNew={false} onSave={vi.fn()} onRemove={onRemove} onClose={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Remove link' }))
    expect(onRemove).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm remove' }))
    expect(onRemove).toHaveBeenCalled()
    unmount()
    render(<LinkDialog title="A → B" initialType="FF" initialLag={1} canEdit={false} isNew={false} onSave={vi.fn()} onRemove={vi.fn()} onClose={vi.fn()} />)
    expect(screen.queryByRole('button', { name: 'Save link' })).toBeNull()
    expect(screen.getByText('Finish to finish, lag 1 day')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/TaskDialog.test.tsx" "src/app/(admin)/projects/[id]/solar/(gated)/schedule/LinkDialog.test.tsx"`
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement `TaskDialog.tsx`**

`…/TaskDialog.tsx`:
```tsx
'use client'
/** Add / edit a task or milestone (spec §14.1). Dates stay 'YYYY-MM-DD' strings end to end. */
import { useState } from 'react'
import {
  GANTT_STATUSES, GANTT_STATUS_LABELS, endForDuration, fitSegments, formatCalendarDate, isCalendarDate, spanDays, splitSegmentsAt,
  type CalendarDate, type GanttStatus, type ScheduleSegment, type ScheduleTaskView, type WorkCalendar,
} from '@esite/shared'
import type { TaskInput, TaskPatch } from '@/lib/solar/schedule/inputs'
import type { ScheduleOwner } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export const SCHEDULE_COLOURS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899', '#14b8a6', '#6b7280'] as const

export type TaskDialogResult = { input: TaskInput } | { patch: TaskPatch }

export function TaskDialog({ mode, initial, owners, cal, canEdit, defaultStart, onSubmit, onDelete, onClose }: {
  mode: 'task' | 'milestone'
  initial: ScheduleTaskView | null
  owners: ScheduleOwner[]
  cal: WorkCalendar
  canEdit: boolean
  defaultStart: CalendarDate
  onSubmit: (r: TaskDialogResult) => Promise<string | null>
  onDelete?: (id: string) => void
  onClose: () => void
}) {
  const milestone = mode === 'milestone'
  const [name, setName] = useState(initial?.name ?? '')
  const [category, setCategory] = useState(initial?.category ?? '')
  const [zone, setZone] = useState(initial?.zone ?? '')
  const [start, setStart] = useState<string>(initial?.start ?? defaultStart)
  const [end, setEnd] = useState<string>(initial?.end ?? defaultStart)
  const [byDuration, setByDuration] = useState(false)
  const [duration, setDuration] = useState(initial ? String(spanDays(cal, initial.start, initial.end)) : '1')
  const [ownerId, setOwnerId] = useState(initial?.ownerId ?? '')
  const [status, setStatus] = useState<GanttStatus>(initial?.status ?? 'not_started')
  const [progress, setProgress] = useState(String(initial?.progress ?? 0))
  const [colour, setColour] = useState(initial?.colour ?? SCHEDULE_COLOURS[0])
  const [description, setDescription] = useState(initial?.description ?? '')
  const [segments, setSegments] = useState<ScheduleSegment[]>(initial?.segments ?? [])
  const [splitAt, setSplitAt] = useState('')
  const [errors, setErrors] = useState<string[]>([])
  const [busy, setBusy] = useState(false)
  const del = useArmedConfirm()

  const durationEnd = (): string | null => {
    const d = Number(duration)
    return isCalendarDate(start) && Number.isInteger(d) && d >= 1 ? endForDuration(cal, start, d) : null
  }
  const effectiveEnd = milestone ? start : byDuration ? durationEnd() ?? '' : segments.length >= 2 ? segments[segments.length - 1].end : end
  const effectiveStart = !milestone && segments.length >= 2 ? segments[0].start : start

  async function save() {
    const errs: string[] = []
    if (!name.trim()) errs.push(milestone ? 'Give the milestone a name.' : 'Give the task a name.')
    if (!isCalendarDate(effectiveStart)) errs.push('Choose a start date.')
    if (!milestone && !isCalendarDate(effectiveEnd)) errs.push(byDuration ? 'The duration must be a whole number of days, at least 1.' : 'Choose an end date.')
    if (isCalendarDate(effectiveStart) && isCalendarDate(effectiveEnd) && effectiveEnd < effectiveStart) errs.push('The end date is before the start date.')
    const pct = Number(progress)
    if (!milestone && (!Number.isInteger(pct) || pct < 0 || pct > 100)) errs.push('Progress is a whole number from 0 to 100.')
    for (let i = 1; i < segments.length; i++) if (segments[i].start <= segments[i - 1].end) errs.push('Segments must not overlap.')
    setErrors(errs)
    if (errs.length) return

    let result: TaskDialogResult
    if (!initial) {
      result = { input: {
        key: 'new', name: name.trim(), start: effectiveStart, end: milestone ? effectiveStart : effectiveEnd, isMilestone: milestone,
        category: category.trim(), zone: zone.trim(), ownerId: ownerId || null, status: milestone ? 'not_started' : status,
        progress: milestone ? 0 : pct, colour, description,
      } }
    } else {
      const patch: TaskPatch = { id: initial.id, expectedUpdatedAt: initial.updatedAt }
      if (name.trim() !== initial.name) patch.name = name.trim()
      if (category.trim() !== initial.category) patch.category = category.trim()
      if (zone.trim() !== initial.zone) patch.zone = zone.trim()
      const segChanged = JSON.stringify(segments) !== JSON.stringify(initial.segments)
      const newEnd = milestone ? effectiveStart : effectiveEnd
      if (segChanged) patch.segments = segments.length >= 2 ? segments : []
      else if (effectiveStart !== initial.start || newEnd !== initial.end) {
        patch.start = effectiveStart
        patch.end = newEnd
        if (initial.segments.length >= 2) patch.segments = fitSegments(initial.segments, initial, { start: effectiveStart, end: newEnd })
      }
      if (ownerId && ownerId !== initial.ownerId) patch.ownerId = ownerId
      if (!milestone && status !== initial.status) patch.status = status
      if (!milestone && pct !== initial.progress) patch.progress = pct
      if (colour !== initial.colour) patch.colour = colour
      if (description !== initial.description) patch.description = description
      result = { patch }
    }
    setBusy(true)
    const err = await onSubmit(result)
    setBusy(false)
    if (err) setErrors([err])
    else onClose()
  }

  const ro = !canEdit
  const label = milestone ? 'milestone' : 'task'
  return (
    <div role="dialog" aria-label={initial ? `Edit ${label}` : `Add ${label}`} style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', padding: 16, borderRadius: 8, width: 520, maxHeight: '90vh', overflow: 'auto', fontSize: 13, display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{initial ? `${initial.ref} — ${initial.name}` : milestone ? 'Add milestone' : 'Add task'}</h2>
        <label>Name <input disabled={ro} value={name} maxLength={300} onChange={(e) => setName(e.target.value)} /></label>
        {!milestone && (
          <>
            <label>Category <input disabled={ro} value={category} maxLength={120} onChange={(e) => setCategory(e.target.value)} /></label>
            <label>Zone <input disabled={ro} value={zone} maxLength={120} onChange={(e) => setZone(e.target.value)} /></label>
          </>
        )}
        <label>{milestone ? 'Date' : 'Start'} <input type="date" disabled={ro || segments.length >= 2} value={start} onChange={(e) => setStart(e.target.value)} /></label>
        {!milestone && segments.length < 2 && (
          <>
            <div role="radiogroup" aria-label="End by">
              <label><input type="radio" disabled={ro} checked={!byDuration} onChange={() => setByDuration(false)} /> End date</label>{' '}
              <label><input type="radio" disabled={ro} checked={byDuration} onChange={() => setByDuration(true)} /> Duration</label>
            </div>
            {byDuration ? (
              <div>
                <input type="number" aria-label="Duration (days)" min={1} disabled={ro} value={duration} onChange={(e) => setDuration(e.target.value)} />
                {durationEnd() && <span style={{ marginLeft: 8 }}>{`Ends ${formatCalendarDate(durationEnd() as string)}`}</span>}
              </div>
            ) : (
              <label>End <input type="date" disabled={ro} value={end} onChange={(e) => setEnd(e.target.value)} /></label>
            )}
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>Counted in {cal.mode === 'working' ? 'working days' : 'calendar days'}.</div>
          </>
        )}
        {!milestone && (
          <>
            <label>Owner{' '}
              <select aria-label="Owner" disabled={ro} value={ownerId} onChange={(e) => setOwnerId(e.target.value)}>
                {!initial && <option value="">Assign automatically (project triage owner)</option>}
                {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
              </select>
            </label>
            <label>Status{' '}
              <select aria-label="Status" disabled={ro} value={status} onChange={(e) => setStatus(e.target.value as GanttStatus)}>
                {GANTT_STATUSES.map((s) => <option key={s} value={s}>{GANTT_STATUS_LABELS[s]}</option>)}
              </select>
            </label>
            {initial?.awaitingSignOff && <div style={{ color: 'var(--c-amber)' }}>Done — waiting for the person who scheduled it to sign it off.</div>}
            <label>Progress % <input type="number" min={0} max={100} step={5} disabled={ro} value={progress} onChange={(e) => setProgress(e.target.value)} /></label>
          </>
        )}
        <label>Colour{' '}
          <select aria-label="Colour" disabled={ro} value={colour} onChange={(e) => setColour(e.target.value)}>
            {[...new Set([colour, ...SCHEDULE_COLOURS])].map((c) => <option key={c} value={c}>{c}</option>)}
          </select>
        </label>
        <label>{milestone ? 'Description' : 'Notes'} <textarea disabled={ro} value={description} maxLength={4000} onChange={(e) => setDescription(e.target.value)} /></label>

        {!milestone && initial && (
          <fieldset>
            <legend>Split bar</legend>
            {segments.length >= 2 && segments.map((s, i) => (
              <div key={i} style={{ display: 'flex', gap: 6 }}>
                <label>{`Segment ${i + 1} start`} <input type="date" disabled={ro} value={s.start}
                  onChange={(e) => setSegments((ss) => ss.map((x, k) => (k === i ? { ...x, start: e.target.value } : x)))} /></label>
                <label>{`Segment ${i + 1} end`} <input type="date" disabled={ro} value={s.end}
                  onChange={(e) => setSegments((ss) => ss.map((x, k) => (k === i ? { ...x, end: e.target.value } : x)))} /></label>
              </div>
            ))}
            {canEdit && (
              <div style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
                <label>Split at <input type="date" value={splitAt} onChange={(e) => setSplitAt(e.target.value)} /></label>
                <button type="button" onClick={() => {
                  const next = splitSegmentsAt({ start: effectiveStart, end: effectiveEnd }, segments, splitAt)
                  if (next) setSegments(next)
                  else setErrors(['Choose a date inside the task, after its first day.'])
                }}>Split</button>
                {segments.length >= 2 && <button type="button" onClick={() => setSegments([])}>Join segments</button>}
              </div>
            )}
          </fieldset>
        )}

        {errors.length > 0 && <ul role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{errors.map((e) => <li key={e}>{e}</li>)}</ul>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {canEdit && initial && onDelete && (del.armed
            ? <button type="button" onClick={() => { del.disarm(); onDelete(initial.id) }}>Confirm delete</button>
            : <button type="button" onClick={del.arm}>{milestone ? 'Delete milestone' : 'Delete task'}</button>)}
          <button type="button" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && <button type="button" className="btn-primary" disabled={busy} onClick={save}>Save</button>}
        </div>
      </div>
    </div>
  )
}
```

Test expectations this code satisfies (checked): the create payload has no `segments` key (none in `input`); in the milestone edit test the dialog opens with `mode="milestone"`, so only `start`/`end` change → `{ id, expectedUpdatedAt, start: '2026-10-09', end: '2026-10-09' }`; in the split test `splitSegmentsAt({2026-10-01..2026-10-05}, [], '2026-10-03')` gives `[10-01..10-02, 10-03..10-05]`, then segment 2 becomes `10-04..10-06` and only `segments` is sent (the server derives the span from them, 00213). The milestone delete button reads "Delete milestone"; the test uses a task.

- [ ] **Step 4: Implement `LinkDialog.tsx`**

`…/LinkDialog.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { LINK_TYPES, LINK_TYPE_LABELS, type LinkType } from '@esite/shared'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export function LinkDialog({ title, initialType, initialLag, canEdit, isNew, onSave, onRemove, onClose }: {
  title: string
  initialType: LinkType
  initialLag: number
  canEdit: boolean
  isNew: boolean
  onSave: (type: LinkType, lagDays: number) => void
  onRemove: () => void
  onClose: () => void
}) {
  const [type, setType] = useState<LinkType>(initialType)
  const [lag, setLag] = useState(String(initialLag))
  const [error, setError] = useState<string | null>(null)
  const rm = useArmedConfirm()
  const n = Number(lag)
  return (
    <div role="dialog" aria-label="Dependency" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', padding: 16, borderRadius: 8, width: 380, fontSize: 13, display: 'grid', gap: 8 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>{title}</h2>
        {canEdit ? (
          <>
            <label>Link type{' '}
              <select aria-label="Link type" value={type} onChange={(e) => setType(e.target.value as LinkType)}>
                {LINK_TYPES.map((t) => <option key={t} value={t}>{`${t} — ${LINK_TYPE_LABELS[t]}`}</option>)}
              </select>
            </label>
            <label>Lag (days) <input type="number" value={lag} onChange={(e) => setLag(e.target.value)} /></label>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>A negative lag is a lead. Counted in the schedule’s duration mode.</div>
          </>
        ) : (
          <div>{`${LINK_TYPE_LABELS[initialType]}, lag ${initialLag} ${Math.abs(initialLag) === 1 ? 'day' : 'days'}`}</div>
        )}
        {error && <div role="alert" style={{ color: 'var(--c-red)' }}>{error}</div>}
        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          {canEdit && !isNew && (rm.armed
            ? <button type="button" onClick={() => { rm.disarm(); onRemove() }}>Confirm remove</button>
            : <button type="button" onClick={rm.arm}>Remove link</button>)}
          <button type="button" onClick={onClose}>{canEdit ? 'Cancel' : 'Close'}</button>
          {canEdit && (
            <button type="button" className="btn-primary" onClick={() => {
              if (!Number.isInteger(n) || Math.abs(n) > 365) { setError('Lag must be a whole number of days between -365 and 365.'); return }
              onSave(type, n)
            }}>{isNew ? 'Add link' : 'Save link'}</button>
          )}
        </div>
      </div>
    </div>
  )
}
```

- [ ] **Step 5: Run — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/TaskDialog.test.tsx" "src/app/(admin)/projects/[id]/solar/(gated)/schedule/LinkDialog.test.tsx"`
Expected: PASS (8 + 3 tests).

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/TaskDialog.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/TaskDialog.test.tsx" \
  "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/LinkDialog.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/LinkDialog.test.tsx"
git commit -m "feat(solar-schedule): task/milestone dialog (end or duration, owner, split bars) and editable links

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 27: Bulk actions bar, stats panel, workload view, shortcuts overlay, empty state

**Files** (`…` as above):
- Create: `…/BulkBar.tsx`, `…/StatsPanel.tsx`, `…/WorkloadView.tsx`, `…/ShortcutsOverlay.tsx`, `…/TemplateStart.tsx`
- Create: `…/panels.test.tsx`

Spec §14.2: bulk bar on selection — set status, colour, progress, owner; **Delete two-step with count**. Stats panel — overall completion %, tasks by status, average progress (weighted by duration), programme duration, critical-path length. Workload — tasks per owner per week, highlight > N concurrent (N = `schedule_settings.workload_threshold`). §14.1 empty state — "Use template" is the primary action, dated from a chosen start.

- [ ] **Step 1: Write the failing test**

`…/panels.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
import { render, screen, fireEvent } from '@testing-library/react'
import { BulkBar } from './BulkBar'
import { StatsPanel } from './StatsPanel'
import { WorkloadView } from './WorkloadView'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { TemplateStart } from './TemplateStart'

const owners = [{ id: 'u1', name: 'Ann Smith', email: 'a@x' }]

describe('BulkBar', () => {
  it('applies status, colour, progress and owner to the selection', () => {
    const h = { onSetStatus: vi.fn(), onSetColour: vi.fn(), onSetProgress: vi.fn(), onSetOwner: vi.fn(), onDelete: vi.fn(), onClear: vi.fn() }
    render(<BulkBar count={3} owners={owners} colours={['#3b82f6', '#ef4444']} {...h} />)
    expect(screen.getByText('3 selected')).toBeTruthy()
    fireEvent.change(screen.getByLabelText('Set status'), { target: { value: 'done' } })
    expect(h.onSetStatus).toHaveBeenCalledWith('done')
    fireEvent.change(screen.getByLabelText('Set colour'), { target: { value: '#ef4444' } })
    expect(h.onSetColour).toHaveBeenCalledWith('#ef4444')
    fireEvent.click(screen.getByRole('button', { name: '50%' }))
    expect(h.onSetProgress).toHaveBeenCalledWith(50)
    fireEvent.change(screen.getByLabelText('Set owner'), { target: { value: 'u1' } })
    expect(h.onSetOwner).toHaveBeenCalledWith('u1')
  })
  it('delete is two-step and names the count', () => {
    const onDelete = vi.fn()
    render(<BulkBar count={3} owners={owners} colours={[]} onSetStatus={vi.fn()} onSetColour={vi.fn()} onSetProgress={vi.fn()} onSetOwner={vi.fn()} onDelete={onDelete} onClear={vi.fn()} />)
    fireEvent.click(screen.getByRole('button', { name: 'Delete 3 tasks' }))
    expect(onDelete).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: delete 3 tasks' }))
    expect(onDelete).toHaveBeenCalled()
  })
})

describe('StatsPanel', () => {
  it('shows the roll-up and warns about broken links', () => {
    render(<StatsPanel mode="working" violations={2} cycle={null} stats={{
      taskCount: 4, milestoneCount: 1, byStatus: { not_started: 1, in_progress: 2, done: 1 }, completionPct: 25,
      weightedProgressPct: 61, programmeDays: 42, criticalPathDays: 40,
    }} />)
    expect(screen.getByText('25%')).toBeTruthy()
    expect(screen.getByText('61%')).toBeTruthy()
    expect(screen.getByText('42 working days')).toBeTruthy()
    expect(screen.getByText('40 working days')).toBeTruthy()
    expect(screen.getByRole('alert').textContent).toBe('2 links are broken by the planned dates (their tasks are on the critical path with negative float).')
  })
  it('an empty schedule shows dashes, not NaN', () => {
    render(<StatsPanel mode="calendar" violations={0} cycle={null} stats={{
      taskCount: 0, milestoneCount: 0, byStatus: { not_started: 0, in_progress: 0, done: 0 }, completionPct: null,
      weightedProgressPct: null, programmeDays: 0, criticalPathDays: null,
    }} />)
    expect(screen.getAllByText('—').length).toBeGreaterThan(0)
    expect(screen.queryByText(/NaN/)).toBeNull()
  })
})

describe('WorkloadView', () => {
  it('flags weeks above the limit', () => {
    render(<WorkloadView threshold={2} ownerNames={new Map([['u1', 'Ann Smith']])} workload={[
      { ownerId: 'u1', weeks: [{ weekStart: '2026-09-28', maxConcurrent: 3, taskIds: ['a', 'b', 'c'], overloaded: true },
        { weekStart: '2026-10-05', maxConcurrent: 1, taskIds: ['a'], overloaded: false }] },
    ]} />)
    expect(screen.getByText('Ann Smith')).toBeTruthy()
    expect(screen.getByLabelText('Ann Smith, week of 28 Sep 2026: 3 at once — more than 2')).toBeTruthy()
    expect(screen.getByLabelText('Ann Smith, week of 5 Oct 2026: 1 at once')).toBeTruthy()
  })
})

describe('ShortcutsOverlay', () => {
  it('lists every shortcut at Edit, and hides edit-only ones at View', () => {
    const { unmount } = render(<ShortcutsOverlay canEdit onClose={vi.fn()} />)
    expect(screen.getByText('Undo')).toBeTruthy()
    expect(screen.getByText('Delete selected (asks to confirm)')).toBeTruthy()
    unmount()
    render(<ShortcutsOverlay canEdit={false} onClose={vi.fn()} />)
    expect(screen.queryByText('Undo')).toBeNull()
    expect(screen.getByText('Search tasks')).toBeTruthy()
  })
})

describe('TemplateStart', () => {
  it('Edit: pick a start date and use the template (the primary action)', () => {
    const onUseTemplate = vi.fn()
    render(<TemplateStart canEdit defaultStart="2026-10-01" onUseTemplate={onUseTemplate} onAddTask={vi.fn()} onImport={vi.fn()} busy={false} />)
    fireEvent.change(screen.getByLabelText('Programme starts'), { target: { value: '2026-11-02' } })
    fireEvent.click(screen.getByRole('button', { name: 'Use template' }))
    expect(onUseTemplate).toHaveBeenCalledWith('2026-11-02')
  })
  it('View: says who can add one', () => {
    render(<TemplateStart canEdit={false} defaultStart="2026-10-01" onUseTemplate={vi.fn()} onAddTask={vi.fn()} onImport={vi.fn()} busy={false} />)
    expect(screen.getByText('No programme yet. Someone with Edit access to Solar can add one.')).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Use template' })).toBeNull()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/panels.test.tsx"`
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement**

`…/BulkBar.tsx`:
```tsx
'use client'
import { GANTT_STATUSES, GANTT_STATUS_LABELS, type GanttStatus } from '@esite/shared'
import type { ScheduleOwner } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

export function BulkBar({ count, owners, colours, onSetStatus, onSetColour, onSetProgress, onSetOwner, onDelete, onClear }: {
  count: number
  owners: ScheduleOwner[]
  colours: string[]
  onSetStatus: (s: GanttStatus) => void
  onSetColour: (c: string) => void
  onSetProgress: (p: number) => void
  onSetOwner: (id: string) => void
  onDelete: () => void
  onClear: () => void
}) {
  const del = useArmedConfirm()
  const noun = `${count} ${count === 1 ? 'task' : 'tasks'}`
  return (
    <div role="region" aria-label="Selected tasks" style={{ display: 'flex', flexWrap: 'wrap', gap: 8, alignItems: 'center', padding: '6px 8px', background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)', borderRadius: 6, fontSize: 12 }}>
      <strong>{`${count} selected`}</strong>
      <select aria-label="Set status" value="" onChange={(e) => e.target.value && onSetStatus(e.target.value as GanttStatus)}>
        <option value="">Status…</option>
        {GANTT_STATUSES.map((s) => <option key={s} value={s}>{GANTT_STATUS_LABELS[s]}</option>)}
      </select>
      <select aria-label="Set colour" value="" onChange={(e) => e.target.value && onSetColour(e.target.value)}>
        <option value="">Colour…</option>
        {[...new Set([...colours, '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6'])].map((c) => <option key={c} value={c}>{c}</option>)}
      </select>
      <span>Progress {[0, 25, 50, 75, 100].map((p) => <button key={p} type="button" onClick={() => onSetProgress(p)}>{`${p}%`}</button>)}</span>
      <select aria-label="Set owner" value="" onChange={(e) => e.target.value && onSetOwner(e.target.value)}>
        <option value="">Owner…</option>
        {owners.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
      {del.armed
        ? <button type="button" onClick={() => { del.disarm(); onDelete() }}>{`Confirm: delete ${noun}`}</button>
        : <button type="button" onClick={del.arm}>{`Delete ${noun}`}</button>}
      <button type="button" onClick={onClear}>Clear selection</button>
    </div>
  )
}
```

`…/StatsPanel.tsx`:
```tsx
'use client'
import { GANTT_STATUSES, GANTT_STATUS_LABELS, type DurationMode, type ScheduleStats } from '@esite/shared'

export function StatsPanel({ stats, mode, violations, cycle }: {
  stats: ScheduleStats
  mode: DurationMode
  violations: number
  cycle: string[] | null
}) {
  const unit = mode === 'working' ? 'working days' : 'calendar days'
  const pct = (v: number | null) => (v === null ? '—' : `${v}%`)
  const days = (v: number | null) => (v === null || v === 0 ? '—' : `${v} ${unit}`)
  const items: Array<[string, string]> = [
    ['Overall completion', pct(stats.completionPct)],
    ['Average progress (weighted by duration)', pct(stats.weightedProgressPct)],
    ['Programme duration', days(stats.programmeDays)],
    ['Critical path', days(stats.criticalPathDays)],
    ['Tasks', String(stats.taskCount)],
    ['Milestones', String(stats.milestoneCount)],
    ...GANTT_STATUSES.map((s) => [GANTT_STATUS_LABELS[s], String(stats.byStatus[s])] as [string, string]),
  ]
  return (
    <section aria-label="Programme statistics" style={{ fontSize: 12 }}>
      <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))', gap: 8, margin: 0 }}>
        {items.map(([k, v]) => (
          <div key={k}><dt style={{ color: 'var(--c-text-dim)' }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>
        ))}
      </dl>
      {violations > 0 && (
        <p role="alert" style={{ color: 'var(--c-red)' }}>{`${violations} ${violations === 1 ? 'link is' : 'links are'} broken by the planned dates (their tasks are on the critical path with negative float).`}</p>
      )}
      {cycle && <p role="alert" style={{ color: 'var(--c-red)' }}>Some tasks depend on each other in a loop, so no critical path can be worked out.</p>}
    </section>
  )
}
```

`…/WorkloadView.tsx`:
```tsx
'use client'
import { addCalendarDays, formatCalendarDate, type OwnerWorkload } from '@esite/shared'

export function WorkloadView({ workload, ownerNames, threshold }: {
  workload: OwnerWorkload[]
  ownerNames: ReadonlyMap<string, string>
  threshold: number
}) {
  const weeks = [...new Set(workload.flatMap((o) => o.weeks.map((w) => w.weekStart)))].sort()
  if (weeks.length === 0) return <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>No open tasks to show.</p>
  return (
    <div style={{ overflowX: 'auto', fontSize: 11 }}>
      <table style={{ borderCollapse: 'collapse' }}>
        <thead><tr><th style={{ textAlign: 'left', padding: 4 }}>Owner</th>{weeks.map((w) => <th key={w} style={{ padding: 4 }}>{formatCalendarDate(w).split(' ').slice(0, 2).join(' ')}</th>)}</tr></thead>
        <tbody>
          {workload.map((o) => {
            const name = ownerNames.get(o.ownerId) ?? 'Former project member'
            const byWeek = new Map(o.weeks.map((w) => [w.weekStart, w]))
            return (
              <tr key={o.ownerId}>
                <td style={{ padding: 4 }}>{name}</td>
                {weeks.map((w) => {
                  const cell = byWeek.get(w)
                  if (!cell) return <td key={w} />
                  const label = `${name}, week of ${formatCalendarDate(w)}: ${cell.maxConcurrent} at once${cell.overloaded ? ` — more than ${threshold}` : ''}`
                  return (
                    <td key={w} aria-label={label} title={`${cell.taskIds.length} tasks between ${formatCalendarDate(w)} and ${formatCalendarDate(addCalendarDays(w, 6))}`}
                      style={{ padding: 4, textAlign: 'center', background: cell.overloaded ? '#fecaca' : '#dcfce7' }}>{cell.maxConcurrent}</td>
                  )
                })}
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}
```

`…/ShortcutsOverlay.tsx`:
```tsx
'use client'
import { SCHEDULE_SHORTCUTS } from '@/lib/solar/schedule/shortcuts'

export function ShortcutsOverlay({ canEdit, onClose }: { canEdit: boolean; onClose: () => void }) {
  const list = SCHEDULE_SHORTCUTS.filter((s) => canEdit || !s.editOnly)
  const groups = [...new Set(list.map((s) => s.group))]
  return (
    <div role="dialog" aria-label="Keyboard shortcuts" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }} onClick={onClose}>
      <div style={{ background: 'var(--c-surface)', padding: 16, borderRadius: 8, width: 420, fontSize: 13 }} onClick={(e) => e.stopPropagation()}>
        <h2 style={{ marginTop: 0, fontSize: 15 }}>Keyboard shortcuts</h2>
        {groups.map((g) => (
          <section key={g}>
            <h3 style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{g}</h3>
            <dl style={{ display: 'grid', gridTemplateColumns: '1fr auto', gap: 4, margin: 0 }}>
              {list.filter((s) => s.group === g).map((s) => (
                <div key={s.action} style={{ display: 'contents' }}><dt>{s.label}</dt><dd style={{ margin: 0 }}><kbd>{s.keys}</kbd></dd></div>
              ))}
            </dl>
          </section>
        ))}
        <button type="button" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
      </div>
    </div>
  )
}
```

`…/TemplateStart.tsx`:
```tsx
'use client'
import { useState } from 'react'
import { isCalendarDate, type CalendarDate } from '@esite/shared'

export function TemplateStart({ canEdit, defaultStart, onUseTemplate, onAddTask, onImport, busy }: {
  canEdit: boolean
  defaultStart: CalendarDate
  onUseTemplate: (start: CalendarDate) => void
  onAddTask: () => void
  onImport: () => void
  busy: boolean
}) {
  const [start, setStart] = useState<string>(defaultStart)
  if (!canEdit) return <p style={{ fontSize: 13, color: 'var(--c-text-dim)' }}>No programme yet. Someone with Edit access to Solar can add one.</p>
  return (
    <div role="region" aria-label="Start the programme" style={{ padding: 24, border: '1px dashed var(--c-border)', borderRadius: 8, display: 'grid', gap: 12, maxWidth: 520 }}>
      <h2 style={{ margin: 0, fontSize: 16 }}>No programme yet</h2>
      <p style={{ margin: 0, fontSize: 13 }}>Start from your organisation’s standard solar programme — design, SSEG approval, procurement, installation, commissioning and handover — dated from the day you choose. You can change everything afterwards.</p>
      <label style={{ fontSize: 13 }}>Programme starts <input type="date" value={start} onChange={(e) => setStart(e.target.value)} /></label>
      <div style={{ display: 'flex', gap: 8 }}>
        <button type="button" className="btn-primary" disabled={busy || !isCalendarDate(start)} onClick={() => onUseTemplate(start)}>Use template</button>
        <button type="button" onClick={onAddTask}>Add a task instead</button>
        <button type="button" onClick={onImport}>Import a programme</button>
      </div>
    </div>
  )
}
```

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/panels.test.tsx"`
Expected: PASS (9 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule"
git commit -m "feat(solar-schedule): bulk bar, stats panel, workload view, shortcuts overlay, empty state

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 28: Import dialog — upload, column mapping, preview with validation, commit

**Files** (`…` as above):
- Create: `…/ImportDialog.tsx`, `…/ImportDialog.test.tsx`

Spec §14.1 Import: "CSV / XLSX / MS Project XML: column mapping, preview, validation (dates, cycles), commit". Append or **replace** (replace is two-step and says how many tasks it will remove); one transaction server-side; owners the file names but the project does not have are listed after the import, never silently dropped.

- [ ] **Step 1: Write the failing test**

`…/ImportDialog.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'

const h = vi.hoisted(() => ({ commit: vi.fn() }))
vi.mock('@/actions/solar-schedule-import.actions', () => ({ commitScheduleImportAction: h.commit }))

import { ImportDialog } from './ImportDialog'
import { makeWorkCalendar } from '@esite/shared'

const P = 'p1'
const table = {
  kind: 'table',
  rows: [['Task', 'Start', 'End', 'Owner'], ['Design', '2026-10-01', '2026-10-05', 'Zed'], ['Install', '06/10/2026', '2026-10-08', '']],
  mapping: { name: 0, category: null, zone: null, start: 1, end: 2, duration: null, owner: 3, progress: null, status: null, milestone: null, predecessors: null, notes: null, colour: null },
}
function mockFetch(body: unknown, status = 200) {
  globalThis.fetch = vi.fn(async () => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })) as never
}
const pick = () => fireEvent.change(screen.getByLabelText('Programme file'), { target: { files: [new File(['x'], 'p.csv')] } })
const base = { projectId: P, cal: makeWorkCalendar('calendar'), onClose: vi.fn(), onImported: vi.fn() }

const realFetch = globalThis.fetch
beforeEach(() => {
  vi.clearAllMocks()
  h.commit.mockResolvedValue({ ok: true, created: 2, unmatchedOwners: [] })
})
afterEach(() => { globalThis.fetch = realFetch })

describe('ImportDialog', () => {
  it('uploads, previews the mapped tasks, and commits the plan', async () => {
    mockFetch(table)
    render(<ImportDialog {...base} existingCount={0} />)
    pick()
    expect(await screen.findByText('2 tasks ready to import')).toBeTruthy()
    expect(screen.getByRole('cell', { name: '6 Oct 2026' })).toBeTruthy()
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(h.commit).toHaveBeenCalledWith({ projectId: P, mode: 'append', plan: expect.objectContaining({ tasks: expect.any(Array) }) }))
    expect(h.commit.mock.calls[0][0].plan.tasks).toHaveLength(2)
    expect(base.onImported).toHaveBeenCalledWith('2 tasks imported.')
  })
  it('remapping a column updates the preview; problems block the import', async () => {
    mockFetch(table)
    render(<ImportDialog {...base} existingCount={0} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.change(screen.getByLabelText('Start date column'), { target: { value: '3' } })
    expect(await screen.findByText('Row 2: "Zed" is not a date. Use 2026-10-01 or 01/10/2026.')).toBeTruthy()
    expect((screen.getByRole('button', { name: /Import/ }) as HTMLButtonElement).disabled).toBe(true)
  })
  it('replace asks twice and says how many tasks go', async () => {
    mockFetch(table)
    render(<ImportDialog {...base} existingCount={3} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.click(screen.getByRole('radio', { name: 'Replace the whole programme' }))
    fireEvent.click(screen.getByRole('button', { name: 'Replace: remove 3 tasks and import 2' }))
    expect(h.commit).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm replace' }))
    await waitFor(() => expect(h.commit).toHaveBeenCalledWith(expect.objectContaining({ mode: 'replace' })))
  })
  it('names owners the project does not have', async () => {
    mockFetch(table)
    h.commit.mockResolvedValue({ ok: true, created: 2, unmatchedOwners: ['Zed'] })
    render(<ImportDialog {...base} existingCount={0} />)
    pick()
    await screen.findByText('2 tasks ready to import')
    fireEvent.click(screen.getByRole('button', { name: 'Import 2 tasks' }))
    await waitFor(() => expect(base.onImported).toHaveBeenCalledWith('2 tasks imported. Not on this project, so given to the default owner: Zed.'))
  })
  it('shows the server’s sentence when the file is refused', async () => {
    mockFetch({ error: 'Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.' }, 400)
    render(<ImportDialog {...base} existingCount={0} />)
    pick()
    expect(await screen.findByText('Use a .csv, .xlsx or Microsoft Project .xml file. Save older .xls files as .xlsx first.')).toBeTruthy()
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ImportDialog.test.tsx"`
Expected: FAIL — cannot resolve `./ImportDialog`.

- [ ] **Step 3: Implement**

`…/ImportDialog.tsx`:
```tsx
'use client'
/** Import a programme (spec §14.1). Parse on the server; map + preview + validate here; commit in one transaction. */
import { useMemo, useState } from 'react'
import {
  GANTT_STATUS_LABELS, IMPORT_FIELDS, IMPORT_FIELD_LABELS, formatCalendarDate, mapImportTable, validateImportPlan,
  type ImportIssue, type ImportMapping, type ImportPlan, type WorkCalendar,
} from '@esite/shared'
import { commitScheduleImportAction } from '@/actions/solar-schedule-import.actions'
import { useArmedConfirm } from '../../_components/useArmedConfirm'

type Parsed = { kind: 'table'; rows: string[][]; mapping: ImportMapping } | { kind: 'plan'; plan: ImportPlan; issues: ImportIssue[] }

export function ImportDialog({ projectId, cal, existingCount, onClose, onImported }: {
  projectId: string
  cal: WorkCalendar
  existingCount: number
  onClose: () => void
  onImported: (message: string) => void
}) {
  const [parsed, setParsed] = useState<Parsed | null>(null)
  const [mapping, setMapping] = useState<ImportMapping | null>(null)
  const [mode, setMode] = useState<'append' | 'replace'>('append')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const confirm = useArmedConfirm()

  async function upload(file: File) {
    setError(null)
    setParsed(null)
    setBusy(true)
    const fd = new FormData()
    fd.append('file', file)
    try {
      const res = await fetch(`/api/projects/${projectId}/solar/schedule/import/parse`, { method: 'POST', body: fd })
      const body = await res.json()
      if (!res.ok) { setError(typeof body?.error === 'string' ? body.error : 'That file could not be read.'); return }
      setParsed(body as Parsed)
      if (body.kind === 'table') setMapping(body.mapping as ImportMapping)
    } catch {
      setError('The file could not be uploaded. Check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }

  const result = useMemo((): { plan: ImportPlan; issues: ImportIssue[] } | null => {
    if (!parsed) return null
    if (parsed.kind === 'plan') return { plan: parsed.plan, issues: parsed.issues }
    const m = mapImportTable(parsed.rows, mapping ?? parsed.mapping, cal)
    return { plan: m.plan, issues: [...m.issues, ...(m.issues.length ? [] : validateImportPlan(m.plan))] }
  }, [parsed, mapping, cal])

  async function commit() {
    if (!result) return
    setBusy(true)
    const res = await commitScheduleImportAction({ projectId, mode, plan: result.plan })
    setBusy(false)
    if ('error' in res) { setError(res.error); return }
    const n = `${res.created} ${res.created === 1 ? 'task' : 'tasks'} imported.`
    onImported(res.unmatchedOwners.length ? `${n} Not on this project, so given to the default owner: ${res.unmatchedOwners.join(', ')}.` : n)
  }

  const count = result?.plan.tasks.length ?? 0
  const blocked = !result || result.issues.length > 0 || count === 0 || busy
  return (
    <div role="dialog" aria-label="Import a programme" style={{ position: 'fixed', inset: 0, background: '#0006', display: 'grid', placeItems: 'center', zIndex: 50 }}>
      <div style={{ background: 'var(--c-surface)', padding: 16, borderRadius: 8, width: 760, maxHeight: '90vh', overflow: 'auto', fontSize: 13, display: 'grid', gap: 10 }}>
        <h2 style={{ margin: 0, fontSize: 15 }}>Import a programme</h2>
        <label>Programme file <input type="file" accept=".csv,.xlsx,.xml" onChange={(e) => { const f = e.target.files?.[0]; if (f) void upload(f) }} /></label>
        <p style={{ margin: 0, fontSize: 11, color: 'var(--c-text-dim)' }}>
          CSV or Excel with a header row (Task, Start, End or Duration, Owner, Predecessors like 3FS+2d …), or a Microsoft Project XML file. Dates like 2026-10-01 or 01/10/2026.
        </p>
        {error && <div role="alert" style={{ color: 'var(--c-red)' }}>{error}</div>}

        {parsed?.kind === 'table' && mapping && (
          <fieldset style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 6 }}>
            <legend>Columns</legend>
            {IMPORT_FIELDS.map((f) => (
              <label key={f} style={{ fontSize: 12 }}>{IMPORT_FIELD_LABELS[f]}{' '}
                <select aria-label={`${IMPORT_FIELD_LABELS[f]} column`} value={mapping[f] ?? ''}
                  onChange={(e) => setMapping({ ...mapping, [f]: e.target.value === '' ? null : Number(e.target.value) })}>
                  <option value="">—</option>
                  {parsed.rows[0].map((h, i) => <option key={i} value={i}>{h || `Column ${i + 1}`}</option>)}
                </select>
              </label>
            ))}
          </fieldset>
        )}

        {result && (
          <>
            {result.issues.length > 0 ? (
              <ul role="alert" style={{ color: 'var(--c-red)', margin: 0 }}>{result.issues.slice(0, 20).map((i) => <li key={i.message}>{i.message}</li>)}</ul>
            ) : (
              <p role="status" style={{ margin: 0 }}>{`${count} ${count === 1 ? 'task' : 'tasks'} ready to import`}</p>
            )}
            <table style={{ fontSize: 11, borderCollapse: 'collapse' }}>
              <thead><tr>{['Task', 'Category', 'Start', 'End', 'Status', 'Owner'].map((hd) => <th key={hd} style={{ textAlign: 'left', padding: 3 }}>{hd}</th>)}</tr></thead>
              <tbody>
                {result.plan.tasks.slice(0, 20).map((t) => (
                  <tr key={t.key}>
                    <td style={{ padding: 3 }}>{t.isMilestone ? `◆ ${t.name}` : t.name}</td>
                    <td style={{ padding: 3 }}>{t.category}</td>
                    <td style={{ padding: 3 }}>{formatCalendarDate(t.start)}</td>
                    <td style={{ padding: 3 }}>{formatCalendarDate(t.end)}</td>
                    <td style={{ padding: 3 }}>{GANTT_STATUS_LABELS[t.status]}</td>
                    <td style={{ padding: 3 }}>{t.ownerHint ?? ''}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {count > 20 && <p style={{ margin: 0, fontSize: 11 }}>{`…and ${count - 20} more.`}</p>}
            <div role="radiogroup" aria-label="Import mode">
              <label><input type="radio" checked={mode === 'append'} onChange={() => { setMode('append'); confirm.disarm() }} /> Add to the programme</label>{' '}
              {existingCount > 0 && <label><input type="radio" checked={mode === 'replace'} onChange={() => setMode('replace')} /> Replace the whole programme</label>}
            </div>
          </>
        )}

        <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
          <button type="button" onClick={onClose}>Cancel</button>
          {mode === 'append' || existingCount === 0 ? (
            <button type="button" className="btn-primary" disabled={blocked} onClick={commit}>{`Import ${count} ${count === 1 ? 'task' : 'tasks'}`}</button>
          ) : confirm.armed ? (
            <button type="button" className="btn-primary" disabled={blocked} onClick={() => { confirm.disarm(); void commit() }}>Confirm replace</button>
          ) : (
            <button type="button" disabled={blocked} onClick={confirm.arm}>{`Replace: remove ${existingCount} ${existingCount === 1 ? 'task' : 'tasks'} and import ${count}`}</button>
          )}
        </div>
      </div>
    </div>
  )
}
```

Check against the "remapping" test: mapping `start → column 3` (Owner) makes row 2's start `"Zed"` → `mapImportTable` reports `Row 2: "Zed" is not a date…`; row 3's start becomes `''` → `Row 3: "" is not a date…`; the Import button (`/Import/`) is disabled because issues exist. The preview test's `getByRole('cell', { name: '6 Oct 2026' })` reads row 3's start `06/10/2026`, parsed day-first.

- [ ] **Step 4: Run — expect PASS**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ImportDialog.test.tsx"`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/ImportDialog.tsx" "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule/ImportDialog.test.tsx"
git commit -m "feat(solar-schedule): import dialog — mapping, validated preview, append or two-step replace

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 29: `ScheduleClient` (state, executor, undo/redo, keyboard) and the page

**Files** (`…` as above):
- Create: `…/ScheduleClient.tsx`, `…/ScheduleClient.test.tsx`
- Create: `…/page.tsx`, `…/page.test.tsx`

`ScheduleClient` owns all view state, derives everything from `ScheduleData` with the pure functions (critical path on **all** tasks, rows/filters/layout on the visible ones), runs every mutation through one executor so undo/redo uses exactly the same paths as the original action, and refreshes with `loadScheduleAction` (never `router.refresh()`). Undo covers every edit made on the page (drag, dialog, bulk, delete, links, reorder); **"Use template" and "Import" are not undoable** — they are one-transaction bulk inserts, and the message after them says to delete tasks to remove them (open question 8).

- [ ] **Step 1: Write the failing tests**

`…/ScheduleClient.test.tsx`:
```tsx
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor, act, within } from '@testing-library/react'
import { forwardRef, useImperativeHandle } from 'react'
import type { ScheduleTaskView } from '@esite/shared'
import type { ScheduleData } from '@/lib/solar/schedule/types'

const h = vi.hoisted(() => ({
  load: vi.fn(), create: vi.fn(), update: vi.fn(), del: vi.fn(), reorder: vi.fn(),
  addLink: vi.fn(), updateLink: vi.fn(), removeLink: vi.fn(), saveBaseline: vi.fn(), deleteBaseline: vi.fn(), loadBaseline: vi.fn(),
  savePreset: vi.fn(), deletePreset: vi.fn(), saveSettings: vi.fn(), applyTemplate: vi.fn(),
}))
vi.mock('@/actions/solar-schedule.actions', () => ({
  loadScheduleAction: h.load, createScheduleTasksAction: h.create, updateScheduleTasksAction: h.update,
  deleteScheduleTasksAction: h.del, reorderScheduleTasksAction: h.reorder,
}))
vi.mock('@/actions/solar-schedule-meta.actions', () => ({
  addScheduleLinkAction: h.addLink, updateScheduleLinkAction: h.updateLink, removeScheduleLinkAction: h.removeLink,
  saveBaselineAction: h.saveBaseline, deleteBaselineAction: h.deleteBaseline, loadBaselineTasksAction: h.loadBaseline,
  saveFilterPresetAction: h.savePreset, deleteFilterPresetAction: h.deletePreset, saveScheduleSettingsAction: h.saveSettings,
}))
vi.mock('@/actions/solar-schedule-template.actions', () => ({ applyScheduleTemplateAction: h.applyTemplate }))
vi.mock('@/actions/solar-schedule-import.actions', () => ({ commitScheduleImportAction: vi.fn() }))
vi.mock('./GanttCanvas', () => ({
  GanttCanvas: forwardRef(function Stub(p: { onBarDrag: (...a: unknown[]) => void; onLinkDraw: (a: string, b: string) => void; onOpenLink: (k: string) => void }, ref) {
    useImperativeHandle(ref, () => ({ exportPng: () => 'data:image/png;base64,AA', scrollToX: vi.fn(), scrollBy: vi.fn() }))
    return (
      <div>
        <button type="button" onClick={() => p.onBarDrag('t1', 'move', 2, null)}>stub drag t1</button>
        <button type="button" onClick={() => p.onLinkDraw('t2', 't1')}>stub link t2 t1</button>
        <button type="button" onClick={() => p.onLinkDraw('t1', 't3')}>stub link t1 t3</button>
      </div>
    )
  }),
}))

import { ScheduleClient } from './ScheduleClient'

const P = 'p1'
const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id.slice(1)}`, name: `Task ${id}`, category: '', zone: '', start: '2026-10-01', end: '2026-10-05',
  isMilestone: false, status: 'not_started', awaitingSignOff: false, progress: 0, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
  sortOrder: Number(id.slice(1)), description: '', updatedAt: 'U1', segments: [], ...over,
})
const data = (over: Partial<ScheduleData> = {}): ScheduleData => ({
  projectId: P, projectName: 'KINGSWALK', canEdit: true, currentUserId: 'u1', today: '2026-09-28',
  tasks: [task('t1'), task('t2', { start: '2026-10-06', end: '2026-10-08' }), task('t3', { start: '2026-10-09', end: '2026-10-09' })],
  links: [{ id: 'd1', predecessorId: 't1', successorId: 't2', type: 'FS', lagDays: 0 }],
  owners: [{ id: 'u1', name: 'Ann', email: 'a@x' }], baselines: [], presets: [],
  settings: { durationMode: 'calendar', workloadThreshold: 2, updatedAt: null }, ...over,
})
const key = (k: string, mods: Record<string, boolean> = {}) => fireEvent.keyDown(window, { key: k, ...mods })

beforeEach(() => {
  vi.clearAllMocks()
  h.update.mockResolvedValue({ ok: true, updated: [] })
  h.del.mockResolvedValue({ ok: true, removed: 1 })
  h.create.mockResolvedValue({ ok: true, ids: { t1: 't9' } })
  h.addLink.mockResolvedValue({ ok: true, id: 'd2' })
})

describe('ScheduleClient', () => {
  it('a drag is one undo step; undo and redo apply real inverse updates with fresh tokens', async () => {
    const moved = data({ tasks: [task('t1', { start: '2026-10-03', end: '2026-10-07', updatedAt: 'U2' }), ...data().tasks.slice(1)] })
    h.load.mockResolvedValue({ ok: true, data: moved })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'stub drag t1' }))
    await waitFor(() => expect(h.update).toHaveBeenCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-03', end: '2026-10-07', expectedUpdatedAt: 'U1' }] }))
    await waitFor(() => expect(h.load).toHaveBeenCalled())
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: [task('t1', { updatedAt: 'U3' }), ...data().tasks.slice(1)] }) })
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-01', end: '2026-10-05', expectedUpdatedAt: 'U2' }] }))
    await act(async () => { key('Z', { metaKey: true, shiftKey: true }) })
    await waitFor(() => expect(h.update).toHaveBeenLastCalledWith({ projectId: P, patches: [{ id: 't1', start: '2026-10-03', end: '2026-10-07', expectedUpdatedAt: 'U3' }] }))
  })

  it('Delete arms a confirm; undo of a delete re-creates the task and its links, then redo deletes the NEW id', async () => {
    h.load.mockResolvedValue({ ok: true, data: data({ tasks: data().tasks.slice(1), links: [] }) })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(screen.getByRole('checkbox', { name: 'Select SOLAR-1' }))
    key('Delete')
    expect(h.del).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Confirm: delete 1 task' }))
    await waitFor(() => expect(h.del).toHaveBeenCalledWith({ projectId: P, taskIds: ['t1'] }))
    await act(async () => { key('z', { ctrlKey: true }) })
    await waitFor(() => expect(h.create).toHaveBeenCalledWith({
      projectId: P,
      tasks: [expect.objectContaining({ key: 't1', name: 'Task t1', start: '2026-10-01', end: '2026-10-05' })],
      links: [{ from: 't1', to: 't2', type: 'FS', lagDays: 0 }],
    }))
    await act(async () => { key('y', { ctrlKey: true }) })
    await waitFor(() => expect(h.del).toHaveBeenLastCalledWith({ projectId: P, taskIds: ['t9'] }))
  })

  it('refuses a link that would close a loop before calling the server', async () => {
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'stub link t2 t1' }))
    expect(await screen.findByText('That link would make these tasks depend on each other in a loop.')).toBeTruthy()
    expect(h.addLink).not.toHaveBeenCalled()
  })

  it('a drawn link opens the link dialog and is added with its type and lag', async () => {
    h.load.mockResolvedValue({ ok: true, data: data() })
    render(<ScheduleClient initial={data()} />)
    fireEvent.click(screen.getByRole('button', { name: 'stub link t1 t3' }))
    fireEvent.change(screen.getByLabelText('Link type'), { target: { value: 'SS' } })
    fireEvent.change(screen.getByLabelText('Lag (days)'), { target: { value: '1' } })
    fireEvent.click(screen.getByRole('button', { name: 'Add link' }))
    await waitFor(() => expect(h.addLink).toHaveBeenCalledWith({ projectId: P, predecessorId: 't1', successorId: 't3', type: 'SS', lagDays: 1 }))
  })

  it('View level: no edit controls and edit shortcuts do nothing', () => {
    render(<ScheduleClient initial={data({ canEdit: false })} />)
    expect(screen.queryByRole('button', { name: 'Add task' })).toBeNull()
    key('n')
    expect(screen.queryByRole('dialog', { name: 'Add task' })).toBeNull()
    key('?', { shiftKey: true })
    expect(screen.getByRole('dialog', { name: 'Keyboard shortcuts' })).toBeTruthy()
  })

  it('an empty schedule offers the template; using it calls the action with the chosen start', async () => {
    h.applyTemplate.mockResolvedValue({ ok: true, count: 14 })
    h.load.mockResolvedValue({ ok: true, data: data() })
    render(<ScheduleClient initial={data({ tasks: [], links: [] })} />)
    fireEvent.change(screen.getByLabelText('Programme starts'), { target: { value: '2026-11-02' } })
    // The toolbar has its own "Use template" (dated today); the empty state's is the one with a chosen start.
    fireEvent.click(within(screen.getByRole('region', { name: 'Start the programme' })).getByRole('button', { name: 'Use template' }))
    await waitFor(() => expect(h.applyTemplate).toHaveBeenCalledWith({ projectId: P, start: '2026-11-02' }))
    expect(await screen.findByText('14 tasks added from the template. Undo does not cover a template — delete tasks to remove them.')).toBeTruthy()
  })
})
```

`…/page.test.tsx`:
```tsx
import { describe, it, expect, vi } from 'vitest'
const h = vi.hoisted(() => ({ createClient: vi.fn(async () => ({})), level: vi.fn(async () => 'view'), load: vi.fn(), client: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: h.createClient }))
vi.mock('@/lib/solar/access', () => ({ requireSolarLevel: h.level }))
vi.mock('@/lib/solar/schedule/loader', () => ({ loadScheduleData: h.load }))
vi.mock('./ScheduleClient', () => ({ ScheduleClient: (p: unknown) => { h.client(p); return null } }))
import Page from './page'

describe('Schedule page', () => {
  it('re-checks View and hands JSON-only data to the client', async () => {
    h.load.mockResolvedValue({ projectId: 'p1', tasks: [] })
    const el = await Page({ params: Promise.resolve({ id: 'p1' }) })
    expect(h.level).toHaveBeenCalledWith('p1', 'view', expect.anything())
    expect(h.load).toHaveBeenCalledWith('p1', expect.anything(), 'view', expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/))
    expect(el.props.initial).toEqual({ projectId: 'p1', tasks: [] })
    expect(JSON.parse(JSON.stringify(el.props.initial))).toEqual(el.props.initial)
  })
})
```

- [ ] **Step 2: Run — expect FAIL**

Run: `pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule/ScheduleClient.test.tsx" "src/app/(admin)/projects/[id]/solar/(gated)/schedule/page.test.tsx"`
Expected: FAIL — unresolved modules.

- [ ] **Step 3: Implement the page**

`…/page.tsx`:
```tsx
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadScheduleData } from '@/lib/solar/schedule/loader'
import { sastToday } from '@esite/shared'
import { ScheduleClient } from './ScheduleClient'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

/** Schedule tab (spec §14). View level reads; Edit and above change. Props are JSON only. */
export default async function SolarSchedulePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const supabase = (await createClient()) as unknown as AnyClient
  const level = await requireSolarLevel(id, 'view', supabase)
  const data = await loadScheduleData(id, supabase, level, sastToday())
  return <ScheduleClient initial={data} />
}
```

- [ ] **Step 4: Implement the client**

`…/ScheduleClient.tsx`:
```tsx
'use client'
/**
 * The Schedule tab (spec §14). One source of truth (ScheduleData from the
 * server), pure derivations, one executor for every mutation so undo/redo
 * runs exactly the same paths. After a mutation the data is re-read with
 * loadScheduleAction — never router.refresh(), which would re-mount the canvas.
 */
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  EMPTY_SCHEDULE_FILTERS, SCHEDULE_ZOOMS, applyBarDrag, applyScheduleFilters, baselineVariance, buildScheduleRows, criticalPath,
  fitSegments, formatCalendarDate, layoutGantt, linkKey, linkWouldCycle, moveSegment, ownerWorkload, reorderTaskIds, scheduleStats,
  type CalendarDate, type DurationMode, type GanttStatus, type LinkType, type ScheduleFilters, type ScheduleGroupBy,
  type ScheduleZoom,
} from '@esite/shared'
import {
  createScheduleTasksAction, deleteScheduleTasksAction, loadScheduleAction, reorderScheduleTasksAction, updateScheduleTasksAction,
} from '@/actions/solar-schedule.actions'
import {
  addScheduleLinkAction, deleteBaselineAction, deleteFilterPresetAction, loadBaselineTasksAction, removeScheduleLinkAction,
  saveBaselineAction, saveFilterPresetAction, saveScheduleSettingsAction, updateScheduleLinkAction,
} from '@/actions/solar-schedule-meta.actions'
import { applyScheduleTemplateAction } from '@/actions/solar-schedule-template.actions'
import {
  EMPTY_HISTORY, entryForCreate, entryForDelete, entryForLinkAdd, entryForLinkRemove, entryForLinkUpdate, entryForReorder, entryForUpdate,
  recordEntry, remapHistoryIds, takeRedo, takeUndo, type History, type HistoryEntry, type ScheduleOp,
} from '@/lib/solar/schedule/history'
import { matchShortcut } from '@/lib/solar/schedule/shortcuts'
import { scheduleCalendar } from '@/lib/solar/schedule/work-calendar'
import type { TaskPatch } from '@/lib/solar/schedule/inputs'
import type { BaselineTaskView, ScheduleData } from '@/lib/solar/schedule/types'
import { useArmedConfirm } from '../../_components/useArmedConfirm'
import { ScheduleToolbar, type ScheduleShow } from './ScheduleToolbar'
import { ScheduleRowList } from './ScheduleRowList'
import { GanttCanvas, type BarDragKind, type GanttCanvasHandle } from './GanttCanvas'
import { TaskDialog, type TaskDialogResult } from './TaskDialog'
import { LinkDialog } from './LinkDialog'
import { BulkBar } from './BulkBar'
import { StatsPanel } from './StatsPanel'
import { WorkloadView } from './WorkloadView'
import { ShortcutsOverlay } from './ShortcutsOverlay'
import { TemplateStart } from './TemplateStart'
import { ImportDialog } from './ImportDialog'

type Dialog =
  | { kind: 'task' | 'milestone'; taskId: string | null }
  | { kind: 'link'; pred: string; succ: string; existing: boolean }
  | { kind: 'import' }
  | { kind: 'help' }
  | null

const LOOP = 'That link would make these tasks depend on each other in a loop.'

export function ScheduleClient({ initial }: { initial: ScheduleData }) {
  const [data, setData] = useState(initial)
  const dataRef = useRef(initial)
  const [history, setHistory] = useState<History>(EMPTY_HISTORY)
  const [zoom, setZoom] = useState<ScheduleZoom>('week')
  const [filters, setFilters] = useState<ScheduleFilters>(EMPTY_SCHEDULE_FILTERS)
  const [show, setShow] = useState<ScheduleShow>({ links: true, milestones: true, split: true })
  const [groupBy, setGroupBy] = useState<ScheduleGroupBy>('none')
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [selected, setSelected] = useState<Set<string>>(new Set())
  const [compareId, setCompareId] = useState<string | null>(null)
  const [baselineTasks, setBaselineTasks] = useState<BaselineTaskView[]>([])
  const [dialog, setDialog] = useState<Dialog>(null)
  const [message, setMessage] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [showWorkload, setShowWorkload] = useState(false)
  const del = useArmedConfirm(5000)
  const canvasRef = useRef<GanttCanvasHandle>(null)
  const searchRef = useRef<HTMLInputElement>(null)
  const P = data.projectId

  const refresh = useCallback(async () => {
    const r = await loadScheduleAction({ projectId: P })
    if ('data' in r) { dataRef.current = r.data; setData(r.data) }
  }, [P])

  // ── derivations ──────────────────────────────────────────────────────────
  const cal = useMemo(() => scheduleCalendar(data.settings.durationMode, data.tasks.flatMap((t) => [t.start, t.end]), data.today),
    [data.settings.durationMode, data.tasks, data.today])
  const cpm = useMemo(() => criticalPath(data.tasks, data.links, cal), [data.tasks, data.links, cal])
  const visible = useMemo(() => applyScheduleFilters(data.tasks, filters, show.milestones), [data.tasks, filters, show.milestones])
  const rows = useMemo(() => buildScheduleRows(visible, groupBy, collapsed), [visible, groupBy, collapsed])
  const baselineMap = useMemo(() => (compareId
    ? new Map(baselineTasks.filter((b) => b.taskId).map((b) => [b.taskId as string, { start: b.start, end: b.end }]))
    : null), [compareId, baselineTasks])
  const layout = useMemo(() => layoutGantt({
    rows, zoom, cal, today: data.today, splitBars: show.split, links: data.links, showLinks: show.links,
    critical: cpm.ok ? cpm.critical : new Set(), criticalLinks: cpm.ok ? cpm.criticalLinks : new Set(), baseline: baselineMap,
  }), [rows, zoom, cal, data.today, show.split, show.links, data.links, cpm, baselineMap])
  const stats = useMemo(() => scheduleStats(data.tasks, cal, cpm), [data.tasks, cal, cpm])
  const workload = useMemo(() => ownerWorkload(data.tasks, data.settings.workloadThreshold, cal), [data.tasks, data.settings.workloadThreshold, cal])
  const variance = useMemo(() => (compareId ? baselineVariance(data.tasks, baselineTasks, cal) : null), [compareId, data.tasks, baselineTasks, cal])
  const colours = useMemo(() => [...new Set(data.tasks.map((t) => t.colour))], [data.tasks])
  const ownerNames = useMemo(() => new Map(data.owners.map((o) => [o.id, o.name])), [data.owners])
  const taskById = (id: string) => dataRef.current.tasks.find((t) => t.id === id)

  // ── the executor: every op goes through the same actions as the original gesture ─
  async function execOps(ops: ScheduleOp[]): Promise<{ error: string | null; idMap: Record<string, string> }> {
    const idMap: Record<string, string> = {}
    for (const op of ops) {
      const cur = dataRef.current
      const linkOf = (p: string, s: string) => cur.links.find((l) => l.predecessorId === p && l.successorId === s)
      let r: { error: string } | { ok: true }
      if (op.kind === 'update') {
        r = await updateScheduleTasksAction({ projectId: P, patches: op.patches.map((p) => ({ ...p, expectedUpdatedAt: taskById(p.id)?.updatedAt ?? null })) })
      } else if (op.kind === 'create') {
        const c = await createScheduleTasksAction({ projectId: P, tasks: op.tasks, links: op.links })
        if ('ids' in c) Object.assign(idMap, c.ids)
        r = c
      } else if (op.kind === 'delete') {
        r = await deleteScheduleTasksAction({ projectId: P, taskIds: op.taskIds })
      } else if (op.kind === 'addLink') {
        r = await addScheduleLinkAction({ projectId: P, predecessorId: op.predecessorId, successorId: op.successorId, type: op.type, lagDays: op.lagDays })
      } else if (op.kind === 'removeLink' || op.kind === 'updateLink') {
        const l = linkOf(op.predecessorId, op.successorId)
        if (!l) return { error: 'That link is no longer on this schedule. Reload to see the current programme.', idMap }
        r = op.kind === 'removeLink'
          ? await removeScheduleLinkAction({ projectId: P, linkId: l.id })
          : await updateScheduleLinkAction({ projectId: P, linkId: l.id, type: op.type, lagDays: op.lagDays })
      } else {
        r = await reorderScheduleTasksAction({ projectId: P, orderedIds: op.orderedIds })
      }
      if ('error' in r) return { error: r.error, idMap }
      await refresh()
    }
    return { error: null, idMap }
  }

  /** Run an entry forward (unless the gesture already did it) and record it for undo. */
  async function perform(entry: HistoryEntry, alreadyDone = false) {
    setMessage(null)
    setBusy(true)
    const res = alreadyDone ? { error: null, idMap: {} } : await execOps(entry.forward)
    if (alreadyDone) await refresh()
    setBusy(false)
    if (res.error) { setMessage(res.error); return false }
    setHistory((h) => recordEntry(h, entry))
    return true
  }

  async function step(direction: 'undo' | 'redo') {
    const t = direction === 'undo' ? takeUndo(history) : takeRedo(history)
    if (!t) return
    setBusy(true)
    const res = await execOps(direction === 'undo' ? t.entry.backward : t.entry.forward)
    setBusy(false)
    if (res.error) {
      setMessage(`${direction === 'undo' ? 'Undo' : 'Redo'} could not be applied: ${res.error} The undo history was cleared.`)
      setHistory(EMPTY_HISTORY)
      return
    }
    setHistory(Object.keys(res.idMap).length ? remapHistoryIds(t.history, res.idMap) : t.history)
    setMessage(`${direction === 'undo' ? 'Undone' : 'Redone'}: ${t.entry.label}.`)
  }

  // ── gestures ─────────────────────────────────────────────────────────────
  const update = (label: string, patches: TaskPatch[]) => perform(entryForUpdate(label, dataRef.current.tasks, patches))

  function onBarDrag(taskId: string, kind: BarDragKind, delta: number, segmentIndex: number | null) {
    const t = taskById(taskId)
    if (!t) return
    if (kind === 'segment' && segmentIndex !== null) {
      const segs = moveSegment(t.segments, segmentIndex, delta)
      if (!segs) { setMessage('Segments of one task cannot overlap.'); return }
      void update('Move segment', [{ id: t.id, segments: segs }])
      return
    }
    const span = applyBarDrag(t, kind === 'segment' ? 'move' : kind, delta)
    const patch: TaskPatch = { id: t.id, start: span.start, end: span.end }
    if (t.segments.length >= 2) patch.segments = fitSegments(t.segments, t, span)
    void update(kind === 'move' ? 'Move task' : 'Resize task', [patch])
  }

  async function createTasks(label: string, tasks: Parameters<typeof entryForCreate>[1], links: Parameters<typeof entryForCreate>[2]) {
    setBusy(true)
    const r = await createScheduleTasksAction({ projectId: P, tasks, links })
    setBusy(false)
    if ('error' in r) return r.error
    await perform(entryForCreate(label, tasks, links, r.ids), true)
    return null
  }

  async function deleteTasks(ids: string[]) {
    const cur = dataRef.current
    const ok = await perform(entryForDelete(`Delete ${ids.length} ${ids.length === 1 ? 'task' : 'tasks'}`, cur.tasks, cur.links, ids))
    if (ok) { setSelected(new Set()); setDialog(null) }
  }

  function drawLink(pred: string, succ: string) {
    const cur = dataRef.current
    if (cur.links.some((l) => l.predecessorId === pred && l.successorId === succ)) { setMessage('Those two tasks are already linked.'); return }
    if (linkWouldCycle(cur.tasks.map((t) => t.id), cur.links, { predecessorId: pred, successorId: succ, type: 'FS', lagDays: 0 })) { setMessage(LOOP); return }
    setDialog({ kind: 'link', pred, succ, existing: false })
  }

  function openLink(key: string) {
    const l = dataRef.current.links.find((x) => linkKey(x) === key)
    if (l) setDialog({ kind: 'link', pred: l.predecessorId, succ: l.successorId, existing: true })
  }

  async function onReorder(moved: string[], beforeId: string | null) {
    const before = [...dataRef.current.tasks].sort((a, b) => a.sortOrder - b.sortOrder).map((t) => t.id)
    const after = reorderTaskIds(before, moved, beforeId)
    if (after.join() !== before.join()) await perform(entryForReorder(before, after))
  }

  async function onDialogSubmit(r: TaskDialogResult): Promise<string | null> {
    if ('input' in r) return createTasks(r.input.isMilestone ? 'Add milestone' : 'Add task', [r.input], [])
    const ok = await update('Edit task', [r.patch])
    return ok ? null : 'The change was not saved.'
  }

  const bulk = (label: string, make: (id: string) => TaskPatch) => update(label, [...selected].map(make))

  async function useTemplate(start: CalendarDate) {
    setBusy(true)
    const r = await applyScheduleTemplateAction({ projectId: P, start })
    setBusy(false)
    if ('error' in r) { setMessage(r.error); return }
    await refresh()
    setMessage(`${r.count} tasks added from the template. Undo does not cover a template — delete tasks to remove them.`)
  }

  async function compare(id: string | null) {
    setCompareId(id)
    if (!id) { setBaselineTasks([]); return }
    const r = await loadBaselineTasksAction({ projectId: P, baselineId: id })
    if ('tasks' in r) setBaselineTasks(r.tasks)
    else setMessage(r.error)
  }

  function exportPng() {
    const url = canvasRef.current?.exportPng()
    if (!url) { setMessage('The chart could not be exported. Try again.'); return }
    const a = document.createElement('a')
    a.href = url
    a.download = `${data.projectName.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-programme.png`
    a.click()
  }

  // ── keyboard ─────────────────────────────────────────────────────────────
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const action = matchShortcut({ key: e.key, ctrlKey: e.ctrlKey, metaKey: e.metaKey, shiftKey: e.shiftKey, altKey: e.altKey, target: e.target as HTMLElement | null }, data.canEdit)
      if (!action) return
      e.preventDefault()
      switch (action) {
        case 'newTask': setDialog({ kind: 'task', taskId: null }); break
        case 'newMilestone': setDialog({ kind: 'milestone', taskId: null }); break
        case 'deleteSelected': if (selected.size) del.arm(); break
        case 'undo': void step('undo'); break
        case 'redo': void step('redo'); break
        case 'selectAll': setSelected(new Set(visible.map((t) => t.id))); break
        case 'clearSelection': setSelected(new Set()); del.disarm(); setDialog(null); break
        case 'zoomIn': setZoom((z) => SCHEDULE_ZOOMS[Math.max(0, SCHEDULE_ZOOMS.indexOf(z) - 1)]); break
        case 'zoomOut': setZoom((z) => SCHEDULE_ZOOMS[Math.min(SCHEDULE_ZOOMS.length - 1, SCHEDULE_ZOOMS.indexOf(z) + 1)]); break
        case 'focusSearch': searchRef.current?.focus(); break
        case 'today': if (layout.todayX !== null) canvasRef.current?.scrollToX(layout.todayX); break
        case 'help': setDialog({ kind: 'help' }); break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  // ── render ───────────────────────────────────────────────────────────────
  const editing = dialog && (dialog.kind === 'task' || dialog.kind === 'milestone') && dialog.taskId ? taskById(dialog.taskId) ?? null : null
  const linkForDialog = dialog?.kind === 'link' && dialog.existing ? data.links.find((l) => l.predecessorId === dialog.pred && l.successorId === dialog.succ) : undefined
  const nameOf = (id: string) => data.tasks.find((t) => t.id === id)?.name ?? ''
  const selCount = selected.size

  return (
    <div style={{ display: 'grid', gap: 12 }}>
      <ScheduleToolbar
        canEdit={data.canEdit} zoom={zoom} onZoom={setZoom}
        search={filters.search} onSearch={(s) => setFilters((f) => ({ ...f, search: s }))} filters={filters} onFilters={setFilters}
        owners={data.owners} colours={colours} presets={data.presets}
        onApplyPreset={(id) => { const p = data.presets.find((x) => x.id === id); if (p) setFilters(p.filters) }}
        onSavePreset={async (name) => { const r = await saveFilterPresetAction({ projectId: P, name, filters }); if ('error' in r) return r.error; await refresh(); return null }}
        onDeletePreset={async (id) => { const r = await deleteFilterPresetAction({ projectId: P, presetId: id }); if ('error' in r) setMessage(r.error); else await refresh() }}
        show={show} onShow={setShow} groupBy={groupBy} onGroupBy={setGroupBy}
        baselines={data.baselines} compareId={compareId} onCompare={(id) => void compare(id)}
        onSaveBaseline={async (name, d) => { const r = await saveBaselineAction({ projectId: P, name, description: d }); if ('error' in r) return r.error; await refresh(); return null }}
        onDeleteBaseline={async (id) => { const r = await deleteBaselineAction({ projectId: P, baselineId: id }); if ('error' in r) setMessage(r.error); else { if (compareId === id) void compare(null); await refresh() } }}
        settings={data.settings}
        onSaveSettings={async (mode: DurationMode, threshold: number) => {
          const r = await saveScheduleSettingsAction({ projectId: P, durationMode: mode, workloadThreshold: threshold, expectedUpdatedAt: data.settings.updatedAt })
          if ('error' in r) return r.error
          await refresh()
          return null
        }}
        canUndo={history.past.length > 0 && !busy} canRedo={history.future.length > 0 && !busy}
        onUndo={() => void step('undo')} onRedo={() => void step('redo')}
        onAddTask={() => setDialog({ kind: 'task', taskId: null })} onAddMilestone={() => setDialog({ kind: 'milestone', taskId: null })}
        onUseTemplate={() => void useTemplate(data.today)} onImport={() => setDialog({ kind: 'import' })}
        onToday={() => { if (layout.todayX !== null) canvasRef.current?.scrollToX(layout.todayX) }}
        onShiftRange={(dir) => canvasRef.current?.scrollBy(dir * 7 * layout.dayWidth)}
        onHelp={() => setDialog({ kind: 'help' })}
        exportBase={`/api/projects/${P}/solar/schedule/export`} onExportPng={exportPng} searchRef={searchRef}
      />

      {message && <div role="status" style={{ fontSize: 12, padding: '6px 10px', border: '1px solid var(--c-border)', borderRadius: 6 }}>{message}</div>}
      {layout.clamped && <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>The programme is long, so it is shown by {layout.zoom}.</div>}

      {data.canEdit && selCount > 0 && (del.armed ? (
        <div role="alertdialog" aria-label="Delete tasks" style={{ display: 'flex', gap: 8, alignItems: 'center', fontSize: 12 }}>
          <span>{`Delete ${selCount} ${selCount === 1 ? 'task' : 'tasks'}? Their work items are dropped and their links removed.`}</span>
          <button type="button" onClick={() => { del.disarm(); void deleteTasks([...selected]) }}>{`Confirm: delete ${selCount} ${selCount === 1 ? 'task' : 'tasks'}`}</button>
          <button type="button" onClick={del.disarm}>Cancel</button>
        </div>
      ) : (
        <BulkBar count={selCount} owners={data.owners} colours={colours}
          onSetStatus={(s: GanttStatus) => void bulk('Set status', (id) => ({ id, status: s }))}
          onSetColour={(c) => void bulk('Set colour', (id) => ({ id, colour: c }))}
          onSetProgress={(p) => void bulk('Set progress', (id) => ({ id, progress: p }))}
          onSetOwner={(o) => void bulk('Set owner', (id) => ({ id, ownerId: o }))}
          onDelete={() => void deleteTasks([...selected])} onClear={() => setSelected(new Set())} />
      ))}

      {data.tasks.length === 0 ? (
        <TemplateStart canEdit={data.canEdit} defaultStart={data.today} busy={busy} onUseTemplate={(s) => void useTemplate(s)}
          onAddTask={() => setDialog({ kind: 'task', taskId: null })} onImport={() => setDialog({ kind: 'import' })} />
      ) : (
        <div style={{ maxHeight: '70vh', overflowY: 'auto', border: '1px solid var(--c-border)', borderRadius: 6 }}>
          <div style={{ display: 'flex' }}>
            <ScheduleRowList rows={rows} canEdit={data.canEdit} selected={selected}
              onToggleSelect={(id) => setSelected((s) => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n })}
              onToggleGroup={(k) => setCollapsed((c) => { const n = new Set(c); if (n.has(k)) n.delete(k); else n.add(k); return n })}
              onOpenTask={(id) => setDialog({ kind: taskById(id)?.isMilestone ? 'milestone' : 'task', taskId: id })}
              onReorder={(m, b) => void onReorder(m, b)} />
            <GanttCanvas ref={canvasRef} layout={layout} canEdit={data.canEdit} selected={selected}
              onBarDrag={onBarDrag} onLinkDraw={drawLink} onOpenLink={openLink}
              onSelect={(id, additive) => setSelected((s) => (additive ? new Set([...s, id]) : new Set([id])))}
              onOpenTask={(id) => setDialog({ kind: taskById(id)?.isMilestone ? 'milestone' : 'task', taskId: id })} />
          </div>
        </div>
      )}

      {data.tasks.length > 0 && (
        <>
          <StatsPanel stats={stats} mode={data.settings.durationMode} violations={cpm.ok ? cpm.violations.length : 0} cycle={cpm.ok ? null : cpm.cycle} />
          {variance && (
            <section aria-label="Baseline variance" style={{ fontSize: 12 }}>
              <h3 style={{ fontSize: 13 }}>Against “{data.baselines.find((b) => b.id === compareId)?.name}”</h3>
              <ul>
                {[...variance.rows.values()].filter((v) => v.startDays !== 0 || v.finishDays !== 0).map((v) => (
                  <li key={v.taskId}>{`${taskById(v.taskId)?.ref} ${nameOf(v.taskId)}: starts ${v.startDays >= 0 ? `${v.startDays} later` : `${-v.startDays} earlier`}, finishes ${v.finishDays >= 0 ? `${v.finishDays} later` : `${-v.finishDays} earlier`} (days)`}</li>
                ))}
                {variance.added.map((id) => <li key={`a${id}`}>{`${taskById(id)?.ref} ${nameOf(id)}: added since the baseline`}</li>)}
                {variance.removed.map((b) => <li key={`r${b.name}${b.start}`}>{`${b.name}: in the baseline (${formatCalendarDate(b.start)} – ${formatCalendarDate(b.end)}), since removed`}</li>)}
              </ul>
            </section>
          )}
          <div>
            <button type="button" aria-expanded={showWorkload} onClick={() => setShowWorkload((v) => !v)}>Resource workload</button>
            {showWorkload && <WorkloadView workload={workload} ownerNames={ownerNames} threshold={data.settings.workloadThreshold} />}
          </div>
        </>
      )}

      {(dialog?.kind === 'task' || dialog?.kind === 'milestone') && (
        <TaskDialog mode={dialog.kind} initial={editing} owners={data.owners} cal={cal} canEdit={data.canEdit} defaultStart={data.today}
          onSubmit={onDialogSubmit} onDelete={(id) => void deleteTasks([id])} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'link' && (
        <LinkDialog title={`${nameOf(dialog.pred)} → ${nameOf(dialog.succ)}`} initialType={linkForDialog?.type ?? 'FS'} initialLag={linkForDialog?.lagDays ?? 0}
          canEdit={data.canEdit} isNew={!dialog.existing} onClose={() => setDialog(null)}
          onRemove={() => { if (linkForDialog) void perform(entryForLinkRemove(linkForDialog)).then(() => setDialog(null)) }}
          onSave={(type: LinkType, lagDays: number) => {
            const entry = linkForDialog ? entryForLinkUpdate(linkForDialog, type, lagDays) : entryForLinkAdd({ predecessorId: dialog.pred, successorId: dialog.succ, type, lagDays })
            void perform(entry).then((ok) => { if (ok) setDialog(null) })
          }} />
      )}
      {dialog?.kind === 'import' && (
        <ImportDialog projectId={P} cal={cal} existingCount={data.tasks.length} onClose={() => setDialog(null)}
          onImported={(msg) => { setDialog(null); void refresh(); setMessage(`${msg} Undo does not cover an import — delete tasks to remove them.`) }} />
      )}
      {dialog?.kind === 'help' && <ShortcutsOverlay canEdit={data.canEdit} onClose={() => setDialog(null)} />}
      {busy && <div aria-live="polite" style={{ position: 'fixed', bottom: 12, right: 12, fontSize: 11 }}>Saving…</div>}
    </div>
  )
}
```

- [ ] **Step 5: Run — expect PASS**

```bash
pnpm --filter web exec vitest run "src/app/(admin)/projects/[id]/solar/(gated)/schedule"
pnpm --filter web type-check
```
Expected: all schedule UI tests PASS; type-check exit 0.

- [ ] **Step 6: Commit**

```bash
git add "apps/web/src/app/(admin)/projects/[id]/solar/(gated)/schedule"
git commit -m "feat(solar-schedule): Schedule tab — client state, one executor, working undo/redo and shortcuts, page

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 30: RBAC matrix, full suites, push, draft PR

**Files:**
- Modify: `docs/rbac-matrix.md` (Solar section, `docs/rbac-matrix.md:119-151`)

`docs/rbac-matrix.md` must gain every new route and action in the same PR (CLAUDE.md "Adding a new admin route or API endpoint requires updating docs/rbac-matrix.md"; docs/solar/03 §5 point 8).

- [ ] **Step 1: RBAC matrix**

In the Solar route table (after the `/projects/[id]/solar/site` row) add:
```markdown
| `/projects/[id]/solar/schedule` | W | W | W | R (chart, filters, own presets, baselines compare, exports; no edit controls) | → locked | → locked | → locked |
```
In the paragraph starting "`/solar/locked` and `/solar/access` sit **outside** …", replace "Tabs other than Overview and Site & Supply have **no route** in Phase 1" with "Tabs other than Overview, Site & Supply and Schedule have **no route** yet".

In the "Solar server actions" table add:
```markdown
| `loadScheduleAction` (`solar-schedule.actions.ts`) | `requireSolarLevel(project, 'view')` | RLS `schedule_*_select` (`solar_can_view`); presets = own rows only |
| `createScheduleTasksAction` / `updateScheduleTasksAction` / `deleteScheduleTasksAction` | `requireSolarLevel(project, 'edit')`; zod; `expectedUpdatedAt` per task | `00213` RPCs `solar.schedule_create_tasks` / `_update_tasks` / `_delete_tasks` (SECURITY DEFINER; each re-checks `solar_can_edit`); the work-item spine's triggers (membership, ref `SOLAR-n`, due date, transition guard — only the gatekeeper closes, so "Done" by anyone else is `answered`, awaiting sign-off). `work_items_insert_gate` still admits only `task` to client sessions, so a `solar_task` can be born only through the RPC |
| `reorderScheduleTasksAction` | Edit | `solar.schedule_reorder` (INVOKER) → RLS `schedule_tasks_update_authz` |
| `addScheduleLinkAction` / `updateScheduleLinkAction` / `removeScheduleLinkAction` (`solar-schedule-meta.actions.ts`) | Edit | RLS per verb (`solar_can_edit`); `schedule_dependencies_bind` refuses self, cross-project and loops |
| `saveBaselineAction` / `deleteBaselineAction` | Edit | `solar.schedule_save_baseline` (INVOKER) + RLS; baseline rows keep removed tasks (`task_id` SET NULL) |
| `loadBaselineTasksAction` | View | RLS `schedule_baseline_tasks_select` |
| `saveFilterPresetAction` / `deleteFilterPresetAction` | **View** (filtering is reading) | RLS: own rows only (`user_id = auth.uid()`), bind trigger pins `user_id` |
| `saveScheduleSettingsAction` | Edit; `expectedUpdatedAt` | RLS `schedule_settings_*` |
| `applyScheduleTemplateAction` (`solar-schedule-template.actions.ts`) | Edit | `solar.schedule_org_template` (definer, re-checks Edit) + `schedule_create_tasks` |
| `saveOrgScheduleTemplateAction` | `requireRole(active org, OWNER_ADMIN)` (`.ok`) | RLS `schedule_templates_*` (owner/admin of the row's org); no DELETE |
| `commitScheduleImportAction` (`solar-schedule-import.actions.ts`) | Edit; re-validates the plan | `schedule_create_tasks` (append or replace in ONE transaction) |
```
In the API table (next to `/api/paystack/solar-subscribe`) add:
```markdown
| `POST /api/projects/[id]/solar/schedule/import/parse` | Solar Edit | Solar Edit | Solar Edit | — | — | — | — |
| `GET /api/projects/[id]/solar/schedule/export/[format]` (`xlsx`, `ics`, `pdf`, `docx`) | Solar View+ | Solar View+ | Solar View+ | Solar View+ | — | — | — |
```
with a footnote: "Both sit outside `(admin)/layout.tsx` and gate themselves with `getSolarAccessLevel` + `solarLevelAllows` (401 signed-out, 403 below the level). The parse route writes nothing (5 MB cap, `.csv`/`.xlsx`/MS Project `.xml`); the export route reads through the caller's session."

Under `/settings/solar` (line 70) nothing changes (already owner/admin); add to its footnote or row text: "includes the org's Solar schedule template (`solar.schedule_templates`)".

- [ ] **Step 2: The three suites, type-check and lint**

```bash
pnpm --filter @esite/shared test 2>&1 | tail -5
pnpm --filter web test 2>&1 | tail -5
pnpm --filter @esite/db test:ci 2>&1 | tail -8
pnpm -r type-check 2>&1 | tail -5
pnpm --filter web lint 2>&1 | tail -5
```
Expected: all green; counts above `/tmp/solar-5b-base.txt` by the new tests. Record the counts in `/tmp/solar-5b-suites.txt`. Any red → fix before pushing (never push red).

- [ ] **Step 3: Re-run the dry run on the final migration text**

```bash
scripts/db/dry-run-migration.sh "$S/green.sql" scripts/db/assert-solar-schedule-roles.sql | tail -60
```
(rebuild `$S/green.sql` from the committed 00213 first, as in Task 11 Step 6). Expected: 56/56 `t`. Append to `/tmp/solar-5b-dryrun.txt`.

- [ ] **Step 4: Commit the matrix, push (SSH — the gh HTTPS token lacks `workflow` scope)**

```bash
git add docs/rbac-matrix.md
git commit -m "docs(rbac): Solar Schedule tab, actions and routes

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
git push -u git@github.com:WattMatt/e-site.git feat/solar-phase-5b
```

- [ ] **Step 5: Draft PR based on `feat/solar-phase-1c`**

Write `/tmp/solar-5b-pr.md` containing, in order:
1. **What** — the Schedule tab (spec §14, D-20): `solar_task` work items + `solar.schedule_*` side tables; CPM with FS/SS/FF/SF + lag on all tasks; working-day mode with SA holidays; baselines with variance days; split bars; per-user presets in the DB; template seeding + org template editor; CSV/XLSX/MS Project import (one transaction); PNG/PDF(A3)/XLSX(round-trippable)/DOCX/ICS export; working undo/redo and shortcuts.
2. **WM defects not repeated** — the table from Part 1.
3. **Migration `00213`** (NOT applied): what it re-declares in the spine (`work_items_source_required`, `work_items_ensure_ref()`), what it leaves alone (`work_items_insert_gate`), the dry-run evidence from `/tmp/solar-5b-dryrun.txt` (red → green 56/56, four mutations).
4. **PR #193 interaction** — its guard re-declaration is compatible; any later re-declaration of the two spine objects must keep the `solar_task` arm.
5. **Suites** — counts before/after from `/tmp/solar-5b-base.txt` and `/tmp/solar-5b-suites.txt`.
6. **Apply checklist** — (a) `00208` and `00209` applied first; (b) re-check the ledger `max(version)`, `origin/main` and every open PR's migration filenames immediately before applying; renumber `00213` (file + assertion header) above the head if taken; (c) merge → deploy workflow → `scripts/verify-migration-applied.ts` checks the `@verify` block and re-checks 00208's schema-wide directives; (d) read `projects.work_item_types` back for `solar_task` — a green workflow is not evidence the migration ran.
7. **Not verified (needs a signed-in human)** — the owner walk: Solar → Schedule from the empty state → Use template (pick a start) → drag a bar, resize to one day, Ctrl+Z / Ctrl+Shift+Z → draw a link and set SS +2 → split a task in the dialog and move a segment → mark a task Done as someone who is not its creator (shows "awaiting sign-off"; the creator sees it in My Work) → save a baseline, move a task, Compare (variance listed) → save a filter preset, reload, preset still there → switch to working days → import an exported XLSX back → export PNG / PDF / Excel / Word / .ics and open each; as a View user confirm no edit controls. Konva has no component test; touch is untested.
8. **Known gaps / owner decisions** — the open questions in Part 5's "Open questions" section with the defaults taken.
9. Last line exactly: `🤖 Generated with [Claude Code](https://claude.com/claude-code)`

```bash
gh pr create --draft --base feat/solar-phase-1c --head feat/solar-phase-5b \
  --title "Solar Phase 5b — Schedule (Gantt) tab: solar_task work items, CPM with lag, baselines, import/export, undo" \
  --body-file /tmp/solar-5b-pr.md
```
Expected: a draft PR URL. Report it with the suite counts and the dry-run result.

---

## Open questions (owner decisions; the plan implements the stated default)

1. **Who signs off a solar task?** Default: `gatekeeper_rule = 'creator'` (as `task`): the person who scheduled it closes it; anyone else marking Done sends it to them as "Done — awaiting sign-off" (the 00196 guard lets only the gatekeeper close). Alternative: `project_pm`.
2. **Solar task write roles in the work-item registry.** Default: `MARKUP_WRITE_ROLES` (owner, admin, PM, contractor). Consequence: an own-org **inspector** with Solar Edit can change Gantt fields but the spine refuses them work-item governance (void/delete, due date; the drag still saves and just does not move the My Work due date). Alternative: `SNAG_FIELD_ROLES` (adds inspector and supplier; suppliers can never hold Solar anyway).
3. **Due date vs end date.** Default: the work item's `due_date` follows the task's end date on every Gantt change the caller may make; a due date changed in My Work does NOT move the bar (the Gantt is the plan). Builders'-shutdown push applies only at creation (00196 behaviour).
4. **Owner = any active project member, including a client viewer?** Default: the spine's rule (any member with an effective role — client viewers included, they may be ball-in-court); the picker lists active members and org owners/admins/PMs. Alternative: only members with a Solar level.
5. **Import owner matching.** Default: email first, then a unique full name; anything else goes to the default owner and is listed after the import. Excel export writes the owner's name (readable), so re-import matches by name.
6. **Default duration mode.** Default: calendar days (spec: working days is "optional"); set per project in Schedule settings. Saturdays are non-working in working mode (Mon–Fri only).
7. **Word export.** Default: included as a minimal OOXML table (Task 20). It duplicates the PDF/XLSX; declining it removes Task 20 and the `docx` format.
8. **Undo scope.** Default: every edit on the page (drag, resize, dialog, bulk, delete, links, reorder, segments); **Use template** and **Import** are not undoable (bulk one-transaction inserts). Undoing a delete re-creates the task as a NEW work item (new `SOLAR-n` ref); the old one stays void in the ledger — a work item cannot leave `void`.
9. **Notifications.** Default: reassignment writes the spine's `reassigned` event and watcher row (spec: "reassignment notifies the new owner (work-item events)"); bell/email arrive with Q1 item 4 — no new `notifications_type_check` value in this phase.
10. **Workload threshold scope.** Default: per project (`schedule_settings.workload_threshold`, default 2), not org-wide, because org settings are readable only by owners/admins (00209) and the workload view is a View-level feature.

