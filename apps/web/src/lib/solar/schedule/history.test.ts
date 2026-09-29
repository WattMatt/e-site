import { describe, it, expect } from 'vitest'
import {
  EMPTY_HISTORY, HISTORY_LIMIT, recordEntry, takeUndo, takeRedo, remapHistoryIds,
  entryForUpdate, entryForDelete, entryForCreate, entryForLinkAdd, entryForLinkRemove, entryForLinkUpdate, entryForReorder,
} from './history'
import type { ScheduleTaskView } from '@esite/shared'
import type { ScheduleLinkView } from './types'

const task = (id: string, over: Partial<ScheduleTaskView> = {}): ScheduleTaskView => ({
  id, workItemId: `w${id}`, ref: `SOLAR-${id}`, name: `Task ${id}`, category: 'C', zone: 'Z', start: '2026-10-01', end: '2026-10-03',
  isMilestone: false, status: 'in_progress', awaitingSignOff: false, gatekeeperId: null, progress: 30, colour: '#3b82f6', ownerId: 'u1', ownerName: 'Ann',
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
  it('update never carries a stale expectedUpdatedAt into history (the executor stamps the live one)', () => {
    const e = entryForUpdate('Move', [task('a')], [{ id: 'a', expectedUpdatedAt: 'OLD', start: '2026-10-04' }])
    expect(e.forward).toEqual([{ kind: 'update', patches: [{ id: 'a', start: '2026-10-04' }] }])
    expect(e.backward).toEqual([{ kind: 'update', patches: [{ id: 'a', start: '2026-10-01' }] }])
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
  it('delete: backward keeps the ORIGINAL sign-off person, so undo does not hand the seat to whoever pressed it', () => {
    const e = entryForDelete('Delete', [task('b', { gatekeeperId: 'gk-original' }), task('c')], [], ['b', 'c'])
    const op = e.backward[0]
    if (op.kind !== 'create') throw new Error('expected create')
    expect(op.tasks.map((t) => t.gatekeeperId)).toEqual(['gk-original', null])
  })
  it('create: backward deletes the ids the server returned', () => {
    const e = entryForCreate('Add task', [{ key: 'new', name: 'N', start: '2026-10-01', end: '2026-10-01' }], [], { new: 't9' })
    expect(e.backward).toEqual([{ kind: 'delete', taskIds: ['t9'] }])
    expect(e.forward).toEqual([{ kind: 'create', tasks: [{ key: 't9', name: 'N', start: '2026-10-01', end: '2026-10-01' }], links: [] }])
  })
  it('link add, remove, edit and reorder', () => {
    expect(entryForLinkAdd({ predecessorId: 'a', successorId: 'b', type: 'SS', lagDays: 2 }).backward)
      .toEqual([{ kind: 'removeLink', predecessorId: 'a', successorId: 'b' }])
    expect(entryForLinkRemove(link('a', 'b')).backward)
      .toEqual([{ kind: 'addLink', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 1 }])
    expect(entryForLinkUpdate(link('a', 'b'), 'FF', 3).backward)
      .toEqual([{ kind: 'updateLink', predecessorId: 'a', successorId: 'b', type: 'FS', lagDays: 1 }])
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
