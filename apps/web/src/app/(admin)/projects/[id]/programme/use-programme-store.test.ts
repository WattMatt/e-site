import { describe, expect, it, vi } from 'vitest'

vi.mock('@/actions/programme.actions', () => ({ saveProgrammeChangesAction: vi.fn(), programmeVersionAction: vi.fn() }))
import type { ProgrammeOp, ProgrammeState } from '@esite/shared/programme'
import type { SaveProgrammeChangesInput, SaveProgrammeResult } from '@/lib/programme/action-types'
import type { ProgrammeViewData } from '@/lib/programme/view-types'
import { activityRow, PROG, programmeTables, VERSION } from '@/lib/programme/test-fixtures'
import {
  createProgrammeStore, rewriteIds, UNDO_DEPTH, UNDO_GONE, type SaveFn,
} from './use-programme-store'

const STALE = 'Someone else changed this programme. Reload to see their version.'

function view(over: Partial<ProgrammeState> = {}): ProgrammeViewData {
  const t = programmeTables()
  const state = {
    programme: t['programme.programmes'][0], calendars: t['programme.calendars'], exceptions: [],
    activities: t['programme.activities'], dependencies: t['programme.dependencies'],
    codeTypes: [], codeValues: [], activityCodes: [],
    fieldUpdateActivityIds: [], assignmentActivityIds: [], baselineActivityIds: [],
    ...over,
  } as unknown as ProgrammeState
  return { state, version: VERSION, activeBaseline: null, baselines: [] }
}

const keys = () => { let n = 0; return () => `k${++n}` }

/** A save that answers in order; each call can be resolved by the test. */
function deferredSave() {
  const calls: Array<{ input: SaveProgrammeChangesInput; resolve: (r: SaveProgrammeResult) => void }> = []
  const save: SaveFn = vi.fn((input: SaveProgrammeChangesInput) => new Promise<SaveProgrammeResult>((resolve) => { calls.push({ input, resolve }) }))
  return { save, calls }
}
const flush = () => new Promise((r) => setTimeout(r, 0))
const ok = (version: string, ids: Record<string, string> = {}): SaveProgrammeResult => ({ ok: true, version, ids, issues: [] })
const newActivity = (key: string, name = 'New'): ProgrammeOp => ({ op: 'upsert_activity', key, fields: { name, type: 'task', original_duration: 3 } })
const names = (s: ProgrammeState) => s.activities.filter((a) => !a.is_tombstoned).map((a) => a.name)

describe('apply: optimistic preview and save', () => {
  it('previews at once, saves the same ops with the version, then takes the new version and real id', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    expect(store.apply([newActivity('n1', 'C')], 'Add activity')).toBe(true)

    let snap = store.getSnapshot()
    expect(names(snap.state)).toEqual(['A', 'B', 'C'])
    expect(snap.state.activities[2].id).toBe('key:n1')
    expect(snap.pending).toBe(true)
    expect(snap.canUndo).toBe(true)
    expect(calls).toHaveLength(1)
    expect(calls[0].input).toEqual({ programmeId: PROG, expectedVersion: VERSION, ops: [newActivity('n1', 'C')] })

    calls[0].resolve(ok('v2', { n1: 'uuid-c' }))
    await flush()
    snap = store.getSnapshot()
    expect(snap.pending).toBe(false)
    expect(snap.version).toBe('v2')
    expect(snap.state.activities.map((a) => a.id)).toEqual(['A', 'B', 'uuid-c'])
    expect(snap.error).toBeNull()
  })

  it('an op the twin refuses is not previewed or saved, and its sentence is shown', () => {
    const { save } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    expect(store.apply([{ op: 'delete_activity', id: 'NOPE' }], 'Delete')).toBe(false)
    const snap = store.getSnapshot()
    expect(snap.error).toBe('That activity no longer exists. Reload to see the current programme.')
    expect(names(snap.state)).toEqual(['A', 'B'])
    expect(snap.canUndo).toBe(false)
    expect(save).not.toHaveBeenCalled()
  })

  it('an edit the engine cannot schedule (a loop) is refused locally with the engine sentence', () => {
    const { save } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    expect(store.apply([{ op: 'upsert_dependency', key: 'l1', pred: 'B', succ: 'A', type: 'FS', lag: 0 }], 'Link')).toBe(false)
    expect(store.getSnapshot().error).toMatch(/\S/)
    expect(save).not.toHaveBeenCalled()
  })

  it('canEdit=false makes apply, undo and redo no-ops', () => {
    const { save } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: false, save, newKey: keys() })
    expect(store.apply([newActivity('n1')], 'Add')).toBe(false)
    store.undo()
    store.redo()
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B'])
    expect(save).not.toHaveBeenCalled()
  })
})

describe('serial saves', () => {
  it('the second save waits for the first, then goes with the new version and the real id', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    // the second gesture refers to the row the first created, by its preview id
    store.apply([{ op: 'upsert_activity', id: 'key:n1', fields: { name: 'C2' } }], 'Rename')
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B', 'C2'])
    await flush()
    expect(calls).toHaveLength(1)

    calls[0].resolve(ok('v2', { n1: 'uuid-c' }))
    await flush()
    expect(calls).toHaveLength(2)
    expect(calls[1].input).toEqual({
      programmeId: PROG, expectedVersion: 'v2', ops: [{ op: 'upsert_activity', id: 'uuid-c', fields: { name: 'C2' } }],
    })
    calls[1].resolve(ok('v3'))
    await flush()
    const snap = store.getSnapshot()
    expect(snap.pending).toBe(false)
    expect(snap.version).toBe('v3')
  })
})

describe('key → id reconciliation through the undo stack', () => {
  it('undo of a created activity sends a delete_activity by its real id', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    calls[0].resolve(ok('v2', { n1: 'uuid-c' }))
    await flush()

    store.undo()
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B'])
    expect(store.getSnapshot().canRedo).toBe(true)
    await flush()
    expect(calls[1].input).toEqual({ programmeId: PROG, expectedVersion: 'v2', ops: [{ op: 'delete_activity', id: 'uuid-c' }] })
    calls[1].resolve(ok('v3'))
    await flush()
    expect(store.getSnapshot().canUndo).toBe(false)
  })

  it('redo re-creates the hard-deleted row under a NEW key, and its id is reconciled again', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    calls[0].resolve(ok('v2', { n1: 'uuid-c' }))
    await flush()
    store.undo()
    calls[1].resolve(ok('v3'))
    await flush()

    store.redo()
    await flush()
    const op = calls[2].input.ops[0] as Extract<ProgrammeOp, { op: 'upsert_activity' }>
    expect(op.op).toBe('upsert_activity')
    expect(op.key).toBe('k1')
    expect(op.key).not.toBe('n1')
    expect(op.fields.name).toBe('C')
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B', 'C'])
    calls[2].resolve(ok('v4', { k1: 'uuid-c2' }))
    await flush()
    expect(store.getSnapshot().state.activities.map((a) => a.id)).toEqual(['A', 'B', 'uuid-c2'])

    // undoing again deletes the re-created row by ITS id
    store.undo()
    await flush()
    expect(calls[3].input.ops).toEqual([{ op: 'delete_activity', id: 'uuid-c2' }])
  })

  it('a key minted in a still-queued gesture is rewritten in the undo snapshots too', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    store.apply([{ op: 'upsert_activity', id: 'key:n1', fields: { name: 'C2' } }], 'Rename')
    calls[0].resolve(ok('v2', { n1: 'uuid-c' }))
    await flush()
    calls[1].resolve(ok('v3'))
    await flush()
    store.undo() // rename back
    await flush()
    expect(calls[2].input.ops).toEqual([{ op: 'upsert_activity', id: 'uuid-c', fields: { name: 'C' } }])
  })
})

describe('refusals', () => {
  it('stale: the preview stays, marked unsaved, and further edits are blocked', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    store.apply([newActivity('n2', 'D')], 'Add')
    calls[0].resolve({ ok: false, error: STALE })
    await flush()
    const snap = store.getSnapshot()
    expect(snap.stale).toBe(true)
    expect(snap.unsaved).toBe(true)
    expect(snap.pending).toBe(false)
    expect(names(snap.state)).toEqual(['A', 'B', 'C', 'D'])
    expect(store.apply([newActivity('n3', 'E')], 'Add')).toBe(false)
    store.undo()
    await flush()
    expect(calls).toHaveLength(1)
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B', 'C', 'D'])
  })

  it('any other refusal rolls back to before the gesture, drops what was queued on it, and shows the sentence', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    store.apply([newActivity('n2', 'D')], 'Add')
    calls[0].resolve({ ok: false, error: 'You do not have permission to edit programmes on this project.' })
    await flush()
    const snap = store.getSnapshot()
    expect(names(snap.state)).toEqual(['A', 'B'])
    expect(snap.error).toBe('You do not have permission to edit programmes on this project.')
    expect(snap.canUndo).toBe(false)
    expect(snap.pending).toBe(false)
    expect(calls).toHaveLength(1)
  })

  it('a save that throws is treated as a refusal, never thrown on', async () => {
    const save: SaveFn = vi.fn(() => Promise.reject(new Error('network')))
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    await flush()
    expect(store.getSnapshot().error).toBe('The programme could not be saved. Try again.')
    expect(names(store.getSnapshot().state)).toEqual(['A', 'B'])
  })

  it('an undo the twin refuses shows the reload sentence and offers Reload; nothing is saved', async () => {
    // P is removed but its child C is live (the database can hold this); C has history, so deleting it tombstones it.
    const v = view({
      activities: [activityRow('P', { type: 'summary', is_tombstoned: true }), activityRow('C', { parent_id: 'P' })] as never,
      dependencies: [], fieldUpdateActivityIds: ['C'],
    })
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(v, { canEdit: true, save, newKey: keys() })
    store.apply([{ op: 'delete_activity', id: 'C' }], 'Delete')
    calls[0].resolve(ok('v2'))
    await flush()
    store.undo()
    const snap = store.getSnapshot()
    expect(snap.error).toBe(UNDO_GONE)
    expect(snap.offerReload).toBe(true)
    expect(snap.canUndo).toBe(true)
    await flush()
    expect(calls).toHaveLength(1)
  })
})

describe('undo depth, version poll and reset', () => {
  it('keeps at most 100 undo entries', async () => {
    const save: SaveFn = vi.fn((i: SaveProgrammeChangesInput) => Promise.resolve(ok(`v${i.ops.length}`)))
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    for (let i = 0; i < UNDO_DEPTH + 5; i++) store.apply([{ op: 'upsert_activity', id: 'A', fields: { name: `A${i}` } }], 'Rename')
    let n = 0
    while (store.getSnapshot().canUndo) { store.undo(); n++ }
    expect(n).toBe(UNDO_DEPTH)
  })

  it('a moved server version marks the screen stale only when nothing is pending', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.noteServerVersion(VERSION)
    expect(store.getSnapshot().stale).toBe(false)
    store.apply([newActivity('n1')], 'Add')
    store.noteServerVersion('elsewhere')
    expect(store.getSnapshot().stale).toBe(false)
    calls[0].resolve(ok('v2', { n1: 'x' }))
    await flush()
    store.noteServerVersion('v2')
    expect(store.getSnapshot().stale).toBe(false)
    store.noteServerVersion('v9')
    expect(store.getSnapshot().stale).toBe(true)
    expect(store.getSnapshot().unsaved).toBe(false)
  })

  it('resetFrom takes a new server view when nothing is pending, clearing stale and history', async () => {
    const { save, calls } = deferredSave()
    const store = createProgrammeStore(view(), { canEdit: true, save, newKey: keys() })
    store.apply([newActivity('n1', 'C')], 'Add')
    expect(store.resetFrom({ ...view(), version: 'v7' })).toBe(false) // pending: kept
    calls[0].resolve({ ok: false, error: STALE })
    await flush()
    const fresh = view({ activities: [activityRow('Z')] as never, dependencies: [] })
    expect(store.resetFrom({ ...fresh, version: 'v7' })).toBe(true)
    const snap = store.getSnapshot()
    expect(snap.stale).toBe(false)
    expect(snap.version).toBe('v7')
    expect(names(snap.state)).toEqual(['Z'])
    expect(snap.canUndo).toBe(false)
  })
})

describe('rewriteIds', () => {
  it('rewrites id-bearing fields and *Ids arrays only, never names or op keys', () => {
    const map = { 'key:n1': 'U' }
    expect(rewriteIds({
      id: 'key:n1', parent_id: 'key:n1', name: 'key:n1', key: 'n1', pred: 'key:n1', fields: { parent_id: 'key:n1', calendar_id: 'X' },
      fieldUpdateActivityIds: ['key:n1', 'B'],
    }, map)).toEqual({
      id: 'U', parent_id: 'U', name: 'key:n1', key: 'n1', pred: 'U', fields: { parent_id: 'U', calendar_id: 'X' },
      fieldUpdateActivityIds: ['U', 'B'],
    })
  })
})
