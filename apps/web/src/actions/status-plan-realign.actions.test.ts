// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, type FakeCall, type FakeResponse } from '@/lib/status-plans/__fixtures__/fake-client'

/** The role helper is mocked with the OBJECT it really returns (role-gate-call-sites contract). */
const { createClientMock, requireEffectiveRoleMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))

import { realignShapesAction } from './status-plan-realign.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const SHEET_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_SHEET = '77777777-7777-4777-8777-777777777777'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const S2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const S3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const OLD = [10, 10, 60, 10, 60, 40, 10, 40]
const NEW = [8, 9, 64, 9, 64, 42, 8, 42]
const T0 = '2026-10-14T07:00:00.000001+00:00'
const T1 = '2026-10-14T08:00:00.000002+00:00'
const T2 = '2026-10-14T08:00:00.000003+00:00'

const SCHEMATIC = { id: PLAN_ID, project_id: PROJECT_ID, purpose: 'distribution_schematic' }

function row(id: string, points: number[], updatedAt: string, extra: Record<string, unknown> = {}) {
  return {
    id, status_plan_id: PLAN_ID, sheet_id: SHEET_ID, shape: 'rect', points, node_id: null, area_type: null,
    detected_tag: null, source: 'manual', created_by: 'u', created_at: T0, updated_at: updatedAt, ...extra,
  }
}

/** The stored rows; an update succeeds only when updated_at still matches, and bumps it. */
type Store = Map<string, ReturnType<typeof row>>
let calls: FakeCall[]
let store: Store
let stamp = 0
/** Make the Nth conditional update (1-based) behave as if someone moved the row first. */
let raceOn: number | null = null
let updateCount = 0

function eqOf(call: FakeCall, col: string): unknown {
  return call.ops.find(([m, a]) => m === 'eq' && a[0] === col)?.[1][1]
}

function responder(call: FakeCall): FakeResponse {
  if (call.table === 'tenants.status_plan_sheets' && call.op === 'select') return { data: { id: SHEET_ID, status_plan_id: PLAN_ID } }
  if (call.table === 'tenants.status_plans' && call.op === 'select') return { data: SCHEMATIC }
  if (call.table === 'tenants.status_plan_shapes' && call.op === 'select') {
    const ids = (call.ops.find(([m]) => m === 'in')?.[1][1] ?? []) as string[]
    return { data: ids.flatMap((id) => (store.has(id) ? [store.get(id)!] : [])) }
  }
  if (call.table === 'tenants.status_plan_shapes' && call.op === 'update') {
    updateCount++
    const id = eqOf(call, 'id') as string
    const cur = store.get(id)
    if (raceOn === updateCount && cur) store.set(id, { ...cur, updated_at: 'someone-else' })
    const now = store.get(id)
    if (!now || now.updated_at !== eqOf(call, 'updated_at')) return { data: [] }
    const next = { ...now, ...(call.payload as object), updated_at: `2026-10-14T09:00:00.${String(++stamp).padStart(6, '0')}+00:00` }
    store.set(id, next)
    return { data: [next] }
  }
  return { data: null }
}

function setup(rows: Array<ReturnType<typeof row>>, userId?: string | null) {
  store = new Map(rows.map((r) => [r.id, r]))
  const f = fakeClient(responder, { userId })
  calls = f.calls
  createClientMock.mockResolvedValue(f.client)
  return f.client
}
const updates = () => calls.filter((c) => c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
  raceOn = null
  updateCount = 0
  stamp = 0
})

describe('realignShapesAction', () => {
  it('moves every shape, conditional on its updated_at, and returns the stored shapes', async () => {
    const client = setup([row(S1, OLD, T1), row(S2, OLD, T2, { node_id: 'n' })])
    const res = await realignShapesAction({
      sheetId: SHEET_ID,
      moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }, { shapeId: S2, expectedUpdatedAt: T2, points: NEW.map((v) => v + 0.004) }],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((s) => [s.id, s.points, s.nodeId])).toEqual([[S1, NEW, null], [S2, NEW, 'n']])
    expect(res.data.every((s) => s.updatedAt.startsWith('2026-10-14T09'))).toBe(true)
    // Points only: the link is never part of a re-align write.
    expect(updates().map((u) => u.payload)).toEqual([{ points: NEW }, { points: NEW }])
    expect(updates().map((u) => eqOf(u, 'updated_at'))).toEqual([T1, T2])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(client, PROJECT_ID, ORG_WRITE_ROLES)
  })

  it('a refused role gate stops before any write (the gate is an object, not a boolean)', async () => {
    setup([row(S1, OLD, T1)])
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] })
    expect(res).toEqual({ ok: false, error: 'Only an owner, admin or project manager can change tenant plans on this project.' })
    expect(updates()).toEqual([])
  })

  it('a stale block refuses EVERYTHING before the first write', async () => {
    setup([row(S1, OLD, T1), row(S2, OLD, 'moved-since'), row(S3, OLD, 'moved-too')])
    const res = await realignShapesAction({
      sheetId: SHEET_ID,
      moves: [
        { shapeId: S1, expectedUpdatedAt: T1, points: NEW },
        { shapeId: S2, expectedUpdatedAt: T2, points: NEW },
        { shapeId: S3, expectedUpdatedAt: T2, points: NEW },
      ],
    })
    expect(res).toEqual({ ok: false, error: 'Someone changed 2 of these blocks — reload and try again. Nothing was moved.', conflict: true })
    expect(updates()).toEqual([])
  })

  it('a shape that has gone counts as changed', async () => {
    setup([row(S1, OLD, T1)])
    const res = await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }, { shapeId: S2, expectedUpdatedAt: T1, points: NEW }] })
    expect(res).toEqual({ ok: false, error: 'Someone changed 1 of these blocks — reload and try again. Nothing was moved.', conflict: true })
  })

  it('a race mid-way puts the blocks already moved back, and says so', async () => {
    setup([row(S1, OLD, T1), row(S2, OLD, T2), row(S3, OLD, T2)])
    raceOn = 2 // S2 is moved by someone else between the read and the write
    const res = await realignShapesAction({
      sheetId: SHEET_ID,
      moves: [
        { shapeId: S1, expectedUpdatedAt: T1, points: NEW },
        { shapeId: S2, expectedUpdatedAt: T2, points: NEW },
        { shapeId: S3, expectedUpdatedAt: T2, points: NEW },
      ],
    })
    expect(res).toEqual({ ok: false, error: 'Someone changed 1 of these blocks — reload and try again. Nothing was moved.', conflict: true })
    // S1 went back to where it was; S3 is untouched or back too.
    expect(store.get(S1)!.points).toEqual(OLD)
    expect(store.get(S3)!.points).toEqual(OLD)
  })

  it('a block that cannot be put back is reported, not hidden', async () => {
    setup([row(S1, OLD, T1), row(S2, OLD, T2)])
    raceOn = 2
    // The put-back of S1 (the 3rd update) is also beaten by someone else.
    let n = 0
    const f = fakeClient((call) => {
      if (call.op === 'update' && ++n === 3) return { data: [] }
      return responder(call)
    })
    calls = f.calls
    createClientMock.mockResolvedValue(f.client)
    const res = await realignShapesAction({
      sheetId: SHEET_ID,
      moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }, { shapeId: S2, expectedUpdatedAt: T2, points: NEW }],
    })
    expect(res).toEqual({
      ok: false,
      error: 'Someone changed 1 of these blocks — reload and try again. 1 block that had already moved could not be put back; reload to see the plan.',
      conflict: true,
    })
  })

  it('refuses a shape on another sheet, and a polygon', async () => {
    setup([row(S1, OLD, T1, { sheet_id: OTHER_SHEET })])
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] }))
      .toEqual({ ok: false, error: 'One of these blocks is not on this sheet. Reload the page.' })
    setup([row(S1, OLD, T1, { shape: 'polygon' })])
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] }))
      .toEqual({ ok: false, error: 'Only rectangles can be re-aligned. Nothing was moved.' })
    expect(updates()).toEqual([])
  })

  it('refuses a tenant-layout plan', async () => {
    const f = fakeClient((call) => (call.table === 'tenants.status_plans' ? { data: { ...SCHEMATIC, purpose: 'tenant_layout' } } : responder(call)))
    store = new Map([[S1, row(S1, OLD, T1)]])
    calls = f.calls
    createClientMock.mockResolvedValue(f.client)
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] }))
      .toEqual({ ok: false, error: 'Re-aligning blocks is only for the line diagram.' })
  })

  it('a degenerate rectangle is refused with the outline sentence before touching the database', async () => {
    const flat = [10, 10, 50, 10, 50, 10, 10, 10]
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: flat }] }))
      .toEqual({ ok: false, error: 'The rectangle has no area — drag it larger. Nothing was moved.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('refuses malformed input, duplicates and more than 500 moves before touching the database', async () => {
    const unreadable = { ok: false, error: 'These blocks could not be read. Run the re-align again.' }
    expect(await realignShapesAction({ sheetId: 'nope', moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] })).toEqual(unreadable)
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [] })).toEqual(unreadable)
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: [1, 2, 3] }] })).toEqual(unreadable)
    const many = Array.from({ length: 501 }, () => ({ shapeId: S1, expectedUpdatedAt: T1, points: NEW }))
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: many })).toEqual(unreadable)
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }, { shapeId: S1, expectedUpdatedAt: T1, points: NEW }] }))
      .toEqual({ ok: false, error: 'The same block is listed twice. Run the re-align again.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('a signed-out caller is told so', async () => {
    setup([], null)
    expect(await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] }))
      .toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
  })

  it('undo is the same call with the previous points and the new updated_at', async () => {
    setup([row(S1, OLD, T1)])
    const moved = await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: T1, points: NEW }] })
    if (!moved.ok) throw new Error(moved.error)
    const undone = await realignShapesAction({ sheetId: SHEET_ID, moves: [{ shapeId: S1, expectedUpdatedAt: moved.data[0]!.updatedAt, points: OLD }] })
    expect(undone.ok && undone.data[0]!.points).toEqual(OLD)
  })
})
