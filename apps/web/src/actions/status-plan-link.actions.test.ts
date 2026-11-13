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

import { linkShapesByLabelAction, unlinkShapesAction } from './status-plan-link.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const SHEET_ID = '66666666-6666-4666-8666-666666666666'
const OTHER_SHEET = '77777777-7777-4777-8777-777777777777'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const S1 = 'aaaaaaaa-0000-4000-8000-000000000001'
const S2 = 'aaaaaaaa-0000-4000-8000-000000000002'
const S3 = 'aaaaaaaa-0000-4000-8000-000000000003'
const N1 = 'bbbbbbbb-0000-4000-8000-000000000001'
const N2 = 'bbbbbbbb-0000-4000-8000-000000000002'
const N3 = 'bbbbbbbb-0000-4000-8000-000000000003'
const POLY = [10, 10, 60, 10, 60, 40]
const T0 = '2026-10-21T07:00:00.000001+00:00'
const T1 = '2026-10-21T08:00:00.000002+00:00'
const T2 = '2026-10-21T08:00:00.000003+00:00'
const T3 = '2026-10-21T08:00:00.000004+00:00'

const FLOOR = { id: PLAN_ID, project_id: PROJECT_ID, purpose: 'tenant_layout' }

function row(id: string, updatedAt: string, extra: Record<string, unknown> = {}) {
  return {
    id, status_plan_id: PLAN_ID, sheet_id: SHEET_ID, shape: 'polygon', points: POLY, node_id: null, area_type: null,
    detected_tag: null, source: 'manual', created_by: 'u', created_at: T0, updated_at: updatedAt, ...extra,
  }
}

type Store = Map<string, ReturnType<typeof row>>
let calls: FakeCall[]
let store: Store
let stamp = 0
/** Per update number (1-based): an error to answer with instead of writing. */
let failOn: Map<number, { code: string; message: string }>
/** Update numbers (1-based) that are beaten by another writer (zero rows). */
let beatOn: Set<number>
let updateCount = 0

function eqOf(call: FakeCall, col: string): unknown {
  return call.ops.find(([m, a]) => m === 'eq' && a[0] === col)?.[1][1]
}

function responder(call: FakeCall): FakeResponse {
  if (call.table === 'tenants.status_plan_sheets' && call.op === 'select') return { data: { id: SHEET_ID, status_plan_id: PLAN_ID } }
  if (call.table === 'tenants.status_plans' && call.op === 'select') return { data: FLOOR }
  if (call.table === 'tenants.status_plan_shapes' && call.op === 'select') {
    const ids = (call.ops.find(([m]) => m === 'in')?.[1][1] ?? []) as string[]
    return { data: ids.flatMap((id) => (store.has(id) ? [store.get(id)!] : [])) }
  }
  if (call.table === 'tenants.status_plan_shapes' && call.op === 'update') {
    updateCount++
    const failure = failOn.get(updateCount)
    if (failure) return { data: null, error: failure }
    const id = eqOf(call, 'id') as string
    const now = store.get(id)
    if (beatOn.has(updateCount) || !now || now.updated_at !== eqOf(call, 'updated_at')) return { data: [] }
    const next = { ...now, ...(call.payload as object), updated_at: `2026-10-21T09:00:00.${String(++stamp).padStart(6, '0')}+00:00` }
    store.set(id, next)
    return { data: [next] }
  }
  return { data: null }
}

function setup(rows: Array<ReturnType<typeof row>>, userId?: string | null, respond: (c: FakeCall) => FakeResponse = responder) {
  store = new Map(rows.map((r) => [r.id, r]))
  const f = fakeClient(respond, { userId })
  calls = f.calls
  createClientMock.mockResolvedValue(f.client)
  return f.client
}
const updates = () => calls.filter((c) => c.op === 'update')

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
  failOn = new Map()
  beatOn = new Set()
  updateCount = 0
  stamp = 0
})

const link = (shapeId: string, nodeId: string, expectedUpdatedAt: string, detectedTag: string | null = 'SHOP 1') =>
  ({ shapeId, nodeId, detectedTag, expectedUpdatedAt })

describe('linkShapesByLabelAction', () => {
  it('links every shape conditionally on updated_at, sets detected_tag, keeps source manual, returns canvas shapes', async () => {
    const client = setup([row(S1, T1), row(S2, T2)])
    const res = await linkShapesByLabelAction({
      sheetId: SHEET_ID,
      links: [link(S1, N1, T1, 'SHOP 1'), link(S2, N2, T2, null)],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((s) => [s.id, s.nodeId, s.detectedTag, s.source])).toEqual([
      [S1, N1, 'SHOP 1', 'manual'],
      [S2, N2, null, 'manual'],
    ])
    expect(res.data.every((s) => s.updatedAt.startsWith('2026-10-21T09'))).toBe(true)
    // Only the link and its label are written: never points, source or area type.
    expect(updates().map((u) => u.payload)).toEqual([
      { node_id: N1, detected_tag: 'SHOP 1' },
      { node_id: N2, detected_tag: null },
    ])
    expect(updates().map((u) => eqOf(u, 'updated_at'))).toEqual([T1, T2])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(client, PROJECT_ID, ORG_WRITE_ROLES)
  })

  it('refuses a plan whose purpose is not tenant_layout', async () => {
    setup([row(S1, T1)], undefined, (c) =>
      c.table === 'tenants.status_plans' ? { data: { ...FLOOR, purpose: 'distribution_schematic' } } : responder(c))
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1)] }))
      .toEqual({ ok: false, error: 'This sheet is not a floor plan.' })
    expect(updates()).toEqual([])
    expect(requireEffectiveRoleMock).not.toHaveBeenCalled()
  })

  it('refuses a caller outside ORG_WRITE_ROLES (the gate is an object, not a boolean)', async () => {
    setup([row(S1, T1)])
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1)] }))
      .toEqual({ ok: false, error: 'Only an owner, admin or project manager can change tenant plans on this project.' })
    expect(updates()).toEqual([])
    expect(calls.some((c) => c.table === 'tenants.status_plan_shapes')).toBe(false)
  })

  it('refuses duplicate shape ids and duplicate node ids within the batch before reading', async () => {
    setup([row(S1, T1), row(S2, T2)])
    const dupShape = await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1), link(S1, N2, T1)] })
    expect(dupShape).toEqual({ ok: false, error: 'The same shape is listed twice. Run the detection again.' })
    const dupNode = await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1), link(S2, N1, T2)] })
    expect(dupNode).toEqual({ ok: false, error: 'The same shop is listed twice. Run the detection again.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('refuses malformed input and more than 500 links before touching the database', async () => {
    const unreadable = { ok: false, error: 'These links could not be read. Run the detection again.' }
    expect(await linkShapesByLabelAction({ sheetId: 'nope', links: [link(S1, N1, T1)] })).toEqual(unreadable)
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [] })).toEqual(unreadable)
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1, 'x'.repeat(65))] })).toEqual(unreadable)
    const many = Array.from({ length: 501 }, (_, i) => link(`aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`, `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`, T1))
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: many })).toEqual(unreadable)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('a signed-out caller is told so', async () => {
    setup([], null)
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1)] }))
      .toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
  })

  it('refuses the whole batch when any shape is stale, gone or already linked, before the first write', async () => {
    setup([row(S1, T1), row(S2, 'moved-since'), row(S3, T3, { node_id: N3 })])
    const res = await linkShapesByLabelAction({
      sheetId: SHEET_ID,
      links: [link(S1, N1, T1), link(S2, N2, T2), link(S3, N3, T3), link('aaaaaaaa-0000-4000-8000-0000000000ff', 'bbbbbbbb-0000-4000-8000-0000000000ff', T1)],
    })
    expect(res).toEqual({ ok: false, error: 'Someone changed 3 of these shapes — reload and try again. Nothing was linked.', conflict: true })
    expect(updates()).toEqual([])
  })

  it('refuses a shape on another sheet, and a shape that is an area', async () => {
    setup([row(S1, T1, { sheet_id: OTHER_SHEET })])
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1)] }))
      .toEqual({ ok: false, error: 'One of these shapes is not on this sheet. Reload the page.' })
    setup([row(S1, T1, { area_type: 'common' })])
    expect(await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1)] }))
      .toEqual({ ok: false, error: 'An area cannot be linked to a shop. Nothing was linked.' })
    expect(updates()).toEqual([])
  })

  it('reads in chunks of 100 ids', async () => {
    const ids = Array.from({ length: 150 }, (_, i) => `aaaaaaaa-0000-4000-8000-${String(i).padStart(12, '0')}`)
    const nodes = Array.from({ length: 150 }, (_, i) => `bbbbbbbb-0000-4000-8000-${String(i).padStart(12, '0')}`)
    setup(ids.map((id) => row(id, T1)))
    const res = await linkShapesByLabelAction({ sheetId: SHEET_ID, links: ids.map((id, i) => link(id, nodes[i]!, T1)) })
    expect(res.ok && res.data.length).toBe(150)
    const reads = calls.filter((c) => c.table === 'tenants.status_plan_shapes' && c.op === 'select')
    expect(reads.map((c) => (c.ops.find(([m]) => m === 'in')![1][1] as string[]).length)).toEqual([100, 50])
  })

  it('on 23505 mid-batch puts back every completed link and reports the tag', async () => {
    setup([row(S1, T1), row(S2, T2), row(S3, T3)])
    failOn.set(2, { code: '23505', message: 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"' })
    const res = await linkShapesByLabelAction({
      sheetId: SHEET_ID,
      links: [link(S1, N1, T1, '1'), link(S2, N2, T2, '2'), link(S3, N3, T3, '3')],
    })
    expect(res).toEqual({ ok: false, error: 'SHOP 2 is already linked to another shape on this plan. Nothing was linked.', conflict: true })
    // The first link was put back, conditional on the updated_at its link returned.
    expect(store.get(S1)).toMatchObject({ node_id: null, detected_tag: null })
    const putBack = updates().find((u) => eqOf(u, 'id') === S1 && (u.payload as { node_id: unknown }).node_id === null)!
    expect(putBack.payload).toEqual({ node_id: null, detected_tag: null })
    expect(String(eqOf(putBack, 'updated_at'))).toMatch(/^2026-10-21T09/)
    expect(store.get(S2)).toMatchObject({ node_id: null })
    expect(store.get(S3)).toMatchObject({ node_id: null })
  })

  it('a race (zero rows) puts back what was linked and says how many changed', async () => {
    setup([row(S1, T1), row(S2, T2)])
    beatOn.add(2)
    const res = await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1), link(S2, N2, T2)] })
    expect(res).toEqual({ ok: false, error: 'Someone changed 1 of these shapes — reload and try again. Nothing was linked.', conflict: true })
    expect(store.get(S1)).toMatchObject({ node_id: null, detected_tag: null })
  })

  it('a put-back restores a detected tag the shape already carried', async () => {
    setup([row(S1, T1, { detected_tag: 'NAME: OLD', source: 'detected' }), row(S2, T2)])
    beatOn.add(2)
    await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1, 'SHOP 1'), link(S2, N2, T2)] })
    expect(store.get(S1)).toMatchObject({ node_id: null, detected_tag: 'NAME: OLD', source: 'detected' })
  })

  it('reports put-backs that fail by shape id', async () => {
    setup([row(S1, T1), row(S2, T2), row(S3, T3)])
    failOn.set(3, { code: '23505', message: 'duplicate key' })
    beatOn.add(4) // the put-back of S1 is beaten by another writer
    const res = await linkShapesByLabelAction({
      sheetId: SHEET_ID,
      links: [link(S1, N1, T1, '1'), link(S2, N2, T2, '2'), link(S3, N3, T3, '3')],
    })
    expect(res.ok).toBe(false)
    if (res.ok) return
    expect(res.conflict).toBe(true)
    expect(res.error).toBe(
      `SHOP 3 is already linked to another shape on this plan. 1 could not be put back: ${S1}.`,
    )
    expect(res.error).not.toContain('Nothing was linked')
  })

  it('another database refusal surfaces as its sentence with the batch put back', async () => {
    setup([row(S1, T1), row(S2, T2)])
    failOn.set(2, { code: '23514', message: 'tenant boards only' })
    const res = await linkShapesByLabelAction({ sheetId: SHEET_ID, links: [link(S1, N1, T1), link(S2, N2, T2)] })
    expect(res).toEqual({ ok: false, error: 'The floor plan links tenant boards only. Nothing was linked.' })
    expect(store.get(S1)).toMatchObject({ node_id: null })
  })
})

describe('unlinkShapesAction', () => {
  const linked = (id: string, t: string, node: string, tag: string | null = 'SHOP 1') =>
    row(id, t, { node_id: node, detected_tag: tag })

  it('clears node_id and detected_tag conditionally and returns the shapes', async () => {
    const client = setup([linked(S1, T1, N1), linked(S2, T2, N2, null)])
    const res = await unlinkShapesAction({
      sheetId: SHEET_ID,
      unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }, { shapeId: S2, expectedUpdatedAt: T2 }],
    })
    expect(res.ok).toBe(true)
    if (!res.ok) return
    expect(res.data.map((s) => [s.id, s.nodeId, s.detectedTag])).toEqual([[S1, null, null], [S2, null, null]])
    expect(updates().map((u) => u.payload)).toEqual([{ node_id: null, detected_tag: null }, { node_id: null, detected_tag: null }])
    expect(updates().map((u) => eqOf(u, 'updated_at'))).toEqual([T1, T2])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(client, PROJECT_ID, ORG_WRITE_ROLES)
  })

  it('refuses a stale row and leaves the rest untouched', async () => {
    setup([linked(S1, T1, N1), linked(S2, 'moved-since', N2)])
    const res = await unlinkShapesAction({
      sheetId: SHEET_ID,
      unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }, { shapeId: S2, expectedUpdatedAt: T2 }],
    })
    expect(res).toEqual({ ok: false, error: 'Someone changed 1 of these shapes — reload and try again. Nothing was unlinked.', conflict: true })
    expect(updates()).toEqual([])
    expect(store.get(S1)).toMatchObject({ node_id: N1, detected_tag: 'SHOP 1' })
  })

  it('a race mid-way restores the links already cleared, tag included', async () => {
    setup([linked(S1, T1, N1, 'SHOP 1'), linked(S2, T2, N2)])
    beatOn.add(2)
    const res = await unlinkShapesAction({
      sheetId: SHEET_ID,
      unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }, { shapeId: S2, expectedUpdatedAt: T2 }],
    })
    expect(res).toEqual({ ok: false, error: 'Someone changed 1 of these shapes — reload and try again. Nothing was unlinked.', conflict: true })
    expect(store.get(S1)).toMatchObject({ node_id: N1, detected_tag: 'SHOP 1' })
  })

  it('refuses a refused role, a non-floor plan, duplicates and a shape on another sheet', async () => {
    setup([linked(S1, T1, N1)])
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'no' })
    expect(await unlinkShapesAction({ sheetId: SHEET_ID, unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }] }))
      .toEqual({ ok: false, error: 'Only an owner, admin or project manager can change tenant plans on this project.' })
    requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
    expect(await unlinkShapesAction({ sheetId: SHEET_ID, unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }, { shapeId: S1, expectedUpdatedAt: T1 }] }))
      .toEqual({ ok: false, error: 'The same shape is listed twice. Reload and try again.' })
    setup([linked(S1, T1, N1, 'x')], undefined, (c) =>
      c.table === 'tenants.status_plans' ? { data: { ...FLOOR, purpose: 'distribution_schematic' } } : responder(c))
    expect(await unlinkShapesAction({ sheetId: SHEET_ID, unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }] }))
      .toEqual({ ok: false, error: 'This sheet is not a floor plan.' })
    setup([row(S1, T1, { sheet_id: OTHER_SHEET, node_id: N1 })])
    expect(await unlinkShapesAction({ sheetId: SHEET_ID, unlinks: [{ shapeId: S1, expectedUpdatedAt: T1 }] }))
      .toEqual({ ok: false, error: 'One of these shapes is not on this sheet. Reload the page.' })
    expect(updates()).toEqual([])
  })
})
