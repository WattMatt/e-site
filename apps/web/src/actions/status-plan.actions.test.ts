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
  createStatusPlanShapeAction,
  updateStatusPlanShapeAction,
  deleteStatusPlanShapeAction,
} from './status-plan.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const P = '11111111-1111-4111-8111-111111111111'
const SH = '22222222-2222-4222-8222-222222222222'
const PL = '33333333-3333-4333-8333-333333333333'
const S = '44444444-4444-4444-8444-444444444444'
const N = '55555555-5555-4555-8555-555555555555'
const TS = '2026-10-09T09:15:42.123456+00:00'
const TS2 = '2026-10-09T09:16:00.000001+00:00'
const TRI = [10, 10, 200.123, 10, 200, 150]

const PLAN = { id: PL, project_id: P, purpose: 'tenant_layout' }
const SHAPE_ROW = {
  id: S, status_plan_id: PL, sheet_id: SH, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null,
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

describe('createStatusPlanShapeAction', () => {
  const ctx = {
    'tenants.status_plan_sheets:select': [{ data: { id: SH, status_plan_id: PL } }],
    'tenants.status_plans:select': [{ data: PLAN }],
  }

  it('creates on the sheet asked for: rounds points, validates them, returns the stored shape', async () => {
    setup({ ...ctx, 'tenants.status_plan_shapes:insert': [{ data: SHAPE_ROW }] })
    const res = await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI })
    expect(res).toMatchObject({ ok: true, data: { id: S, sheetId: SH, points: [10, 10, 200.12, 10, 200, 150], updatedAt: TS } })
    expect(writes()[0]!.payload).toEqual({
      status_plan_id: PL, sheet_id: SH, shape: 'polygon', points: [10, 10, 200.12, 10, 200, 150], node_id: null, area_type: null, source: 'manual',
    })
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(expect.anything(), P, ORG_WRITE_ROLES)
  })

  it('refuses a rectangle that is not 4 corners without a round trip', async () => {
    setup({})
    const res = await createStatusPlanShapeAction({ sheetId: SH, shape: 'rect', points: TRI })
    expect(res.ok).toBe(false)
    expect(calls).toEqual([])
  })

  it('refuses an area type on a line diagram', async () => {
    setup({ ...ctx, 'tenants.status_plans:select': [{ data: { ...PLAN, purpose: 'distribution_schematic' } }] })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI, areaType: 'common' }))
      .toMatchObject({ ok: false, error: 'Area types are for the floor plan only.' })
    expect(writes()).toEqual([])
  })

  it('a sheet that is gone says so', async () => {
    setup({ 'tenants.status_plan_sheets:select': [{ data: null }] })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI }))
      .toMatchObject({ ok: false, error: expect.stringMatching(/sheet no longer exists/) })
  })

  it('a non-writer writes nothing', async () => {
    setup(ctx)
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    expect(await createStatusPlanShapeAction({ sheetId: SH, shape: 'polygon', points: TRI }))
      .toEqual({ ok: false, error: expect.stringMatching(/owner, admin or project manager/) })
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
