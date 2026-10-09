// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, queued, opsOf, type FakeResponse } from '@/lib/status-plans/__fixtures__/fake-client'

/**
 * Three things a mocked test CAN see and must pin:
 *  - the gate is consulted with ORG_WRITE_ROLES on the plan's own project, and
 *    a refusal writes nothing;
 *  - shape writes are conditional on updated_at in the SAME statement, and a
 *    zero-row answer is reported as a conflict, not as success;
 *  - organisation_id / created_by / source_file_path are never sent (the
 *    slice-1 triggers bind them).
 * The role helper is mocked with the OBJECT it really returns — a boolean mock
 * is how an inert gate passed tests before (role-gate-call-sites contract).
 */

const { createClientMock, requireEffectiveRoleMock, revalidatePathMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))

import {
  createStatusPlanAction,
  renameStatusPlanAction,
  deleteStatusPlanAction,
  reanchorStatusPlanAction,
  createStatusPlanShapeAction,
  updateStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
} from './status-plan.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const FP = '22222222-2222-4222-8222-222222222222'
const PL = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const N = '55555555-5555-4555-8555-555555555555'
const TS = '2026-10-09T09:15:42.123456+00:00'
const TS2 = '2026-10-09T09:16:00.000001+00:00'
const TRI = [10, 10, 200.123, 10, 200, 150]

const PLAN = { id: PL, project_id: P, purpose: 'tenant_layout', floor_plan_id: FP }
const SHAPE_ROW = {
  id: S, status_plan_id: PL, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null,
  detected_tag: null, source: 'manual', created_by: 'u', created_at: TS, updated_at: TS,
}

let calls: ReturnType<typeof fakeClient>['calls']
function setup(map: Record<string, FakeResponse[]>, userId?: string | null) {
  const f = fakeClient(queued(map), { userId })
  calls = f.calls
  createClientMock.mockResolvedValue(f.client)
}
const writes = () => calls.filter((c) => c.op !== 'select')

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'project_manager' })
})

describe('createStatusPlanAction', () => {
  const input = { projectId: P, floorPlanId: FP, pageIndex: 2, purpose: 'tenant_layout' as const, name: '  Ground floor  ' }

  it('creates the plan with only the columns the client may choose', async () => {
    setup({
      'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x/E-100.pdf' } }],
      'tenants.status_plans:insert': [{ data: { id: PL } }],
    })
    expect(await createStatusPlanAction(input)).toEqual({ ok: true, data: { id: PL } })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
    expect(writes()[0]!.payload).toEqual({ project_id: P, floor_plan_id: FP, page_index: 2, purpose: 'tenant_layout', name: 'Ground floor' })
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${P}/status-plans`)
  })

  it('refuses a non-writer and writes nothing', async () => {
    setup({})
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await createStatusPlanAction(input)
    expect(res).toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
    expect(writes()).toEqual([])
  })

  it('refuses a drawing from another project and a drawing the canvas cannot render', async () => {
    setup({ 'tenants.floor_plans:select': [{ data: { id: FP, project_id: 'other', file_path: 'x.pdf' } }] })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: 'That drawing is not on this project.' })
    setup({ 'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x.dwg' } }] })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/PDF or image/) })
  })

  it('maps the duplicate-plan key to a sentence', async () => {
    setup({
      'tenants.floor_plans:select': [{ data: { id: FP, project_id: P, file_path: 'x.pdf' } }],
      'tenants.status_plans:insert': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plans_drawing_page_purpose_key"' } }],
    })
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/already has a plan/) })
  })

  it('rejects bad input before touching the database', async () => {
    setup({})
    expect(await createStatusPlanAction({ ...input, name: '   ' })).toMatchObject({ ok: false, error: 'Give the plan a name.' })
    expect(await createStatusPlanAction({ ...input, pageIndex: 0 })).toMatchObject({ ok: false })
    expect(calls).toEqual([])
  })

  it('a signed-out caller is told so', async () => {
    setup({}, null)
    expect(await createStatusPlanAction(input)).toMatchObject({ ok: false, error: expect.stringMatching(/Sign in/) })
  })
})

describe('plan rename / delete / re-anchor', () => {
  it('rename returns the stored name and updated_at', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plans:update': [{ data: { name: 'Level 1', updated_at: TS2 } }],
    })
    expect(await renameStatusPlanAction({ planId: PL, name: 'Level 1' })).toEqual({ ok: true, data: { name: 'Level 1', updatedAt: TS2 } })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('delete reports a plan that was already gone', async () => {
    setup({ 'tenants.status_plans:select': [{ data: PLAN }], 'tenants.status_plans:delete': [{ data: null }] })
    expect(await deleteStatusPlanAction({ planId: PL })).toMatchObject({ ok: false, error: expect.stringMatching(/no longer exists/) })
  })

  it("re-anchor writes the drawing's CURRENT file, read on the server", async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.floor_plans:select': [{ data: { file_path: 'x/E-100 rev C.pdf' } }],
      'tenants.status_plans:update': [{ data: { source_file_path: 'x/E-100 rev C.pdf' } }],
    })
    expect(await reanchorStatusPlanAction({ planId: PL })).toEqual({ ok: true, data: { sourceFilePath: 'x/E-100 rev C.pdf' } })
    expect(writes()[0]!.payload).toEqual({ source_file_path: 'x/E-100 rev C.pdf' })
  })
})

describe('createStatusPlanShapeAction', () => {
  it('rounds points, validates them, and returns the stored shape', async () => {
    setup({
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_shapes:insert': [{ data: SHAPE_ROW }],
    })
    const res = await createStatusPlanShapeAction({ planId: PL, shape: 'polygon', points: TRI })
    expect(res).toMatchObject({ ok: true, data: { id: S, points: [10, 10, 200.12, 10, 200, 150], updatedAt: TS } })
    expect(writes()[0]!.payload).toEqual({
      status_plan_id: PL, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null, source: 'manual',
    })
  })

  it('refuses a rectangle that is not 4 corners without a round trip', async () => {
    setup({})
    const res = await createStatusPlanShapeAction({ planId: PL, shape: 'rect', points: TRI })
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses an area type on a schematic plan', async () => {
    setup({ 'tenants.status_plans:select': [{ data: { ...PLAN, purpose: 'distribution_schematic' } }] })
    expect(await createStatusPlanShapeAction({ planId: PL, shape: 'polygon', points: TRI, areaType: 'common' }))
      .toMatchObject({ ok: false, error: 'Area types are for tenant layout plans only.' })
    expect(writes()).toEqual([])
  })
})

describe('updateStatusPlanShapeAction', () => {
  const base = {
    'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }],
    'tenants.status_plans:select': [{ data: PLAN }],
  }

  it('links a board, clears the area type, and is conditional on updated_at', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:update': [{ data: { ...SHAPE_ROW, node_id: N, updated_at: TS2 } }] })
    const res = await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, nodeId: N })
    expect(res).toMatchObject({ ok: true, data: { nodeId: N, updatedAt: TS2 } })
    const upd = calls.find((c) => c.op === 'update')!
    expect(upd.payload).toEqual({ node_id: N, area_type: null })
    expect(upd.ops).toContainEqual(['eq', ['id', S]])
    expect(upd.ops).toContainEqual(['eq', ['updated_at', TS]])
  })

  it('zero rows with the shape still there is a conflict', async () => {
    setup({
      ...base,
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }, { data: { id: S } }],
      'tenants.status_plan_shapes:update': [{ data: null }],
    })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI })).toEqual({
      ok: false, error: 'This shape was changed by someone else — reload to see it.', conflict: true,
    })
  })

  it('zero rows with the shape gone says so', async () => {
    setup({
      ...base,
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }, { data: null }],
      'tenants.status_plan_shapes:update': [{ data: null }],
    })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/deleted by someone else/), conflict: true })
  })

  it('maps "board already on this plan"', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:update': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"' } }] })
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, nodeId: N }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/already on this plan/) })
  })

  it('a patch with nothing in it is refused', async () => {
    setup({})
    expect(await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS })).toMatchObject({ ok: false, error: 'Nothing to change.' })
  })

  it('validates new points against the STORED shape kind', async () => {
    setup({ ...base, 'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'rect' } }] })
    const res = await updateStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS, points: TRI })
    expect(res.ok).toBe(false)
    expect(writes()).toEqual([])
  })
})

describe('deleteStatusPlanShapeAction', () => {
  it('is conditional on updated_at', async () => {
    setup({
      'tenants.status_plan_shapes:select': [{ data: { id: S, status_plan_id: PL, shape: 'polygon' } }],
      'tenants.status_plans:select': [{ data: PLAN }],
      'tenants.status_plan_shapes:delete': [{ data: { id: S } }],
    })
    expect(await deleteStatusPlanShapeAction({ shapeId: S, expectedUpdatedAt: TS })).toEqual({ ok: true, data: { id: S } })
    expect(opsOf(calls, 'tenants.status_plan_shapes', 'delete')).toContainEqual(['eq', ['updated_at', TS]])
  })
})
