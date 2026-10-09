// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { fakeClient, queued, type FakeResponse } from '@/lib/status-plans/__fixtures__/fake-client'

/**
 * The role helper is mocked with the OBJECT it really returns; a boolean mock
 * is how an inert gate passed tests before (role-gate-call-sites contract).
 */
const { createClientMock, requireEffectiveRoleMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  requireEffectiveRoleMock: vi.fn(),
}))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock, createServiceClient: vi.fn() }))
vi.mock('@/lib/auth/require-role', () => ({ requireEffectiveRole: (...a: unknown[]) => requireEffectiveRoleMock(...a) }))

import { acceptDetectedBlocksAction } from './status-plan-detection.actions'
import { ORG_WRITE_ROLES } from '@esite/shared'

const PLAN_ID = '22222222-2222-4222-8222-222222222222'
const PROJECT_ID = '33333333-3333-4333-8333-333333333333'
const NODE_A = '44444444-4444-4444-8444-444444444444'
const NODE_B = '55555555-5555-4555-8555-555555555555'
const RECT = [95, 85, 221.5, 85, 221.5, 203.5, 95, 203.5]
const TS = '2026-10-09T09:15:42.123456+00:00'

const SCHEMATIC = { id: PLAN_ID, project_id: PROJECT_ID, purpose: 'distribution_schematic', floor_plan_id: 'f' }

function shapeRow(id: string, nodeId: string | null, tag: string | null) {
  return {
    id, status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: nodeId, area_type: null,
    detected_tag: tag, source: 'detected', created_by: 'u', created_at: TS, updated_at: TS,
  }
}

let calls: ReturnType<typeof fakeClient>['calls']
function setup(map: Record<string, FakeResponse[]>, userId?: string | null) {
  const f = fakeClient(queued(map), { userId })
  calls = f.calls
  createClientMock.mockResolvedValue(f.client)
  return f.client
}
const inserts = () => calls.filter((c) => c.op === 'insert')

beforeEach(() => {
  vi.clearAllMocks()
  requireEffectiveRoleMock.mockResolvedValue({ ok: true, role: 'admin' })
})

describe('acceptDetectedBlocksAction', () => {
  it('inserts every block as a detected rect in ONE statement and returns the canvas shapes', async () => {
    const client = setup({
      'tenants.status_plans:select': [{ data: SCHEMATIC }],
      'tenants.status_plan_shapes:insert': [{ data: [shapeRow('s1', NODE_A, 'DB-71'), shapeRow('s2', null, 'NAME: DELTA KIOSK')] }],
    })
    const res = await acceptDetectedBlocksAction({
      planId: PLAN_ID,
      blocks: [
        { points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' },
        { points: RECT.map((v) => v + 0.004), nodeId: null, detectedTag: 'NAME: DELTA KIOSK' },
      ],
    })
    expect(res.ok).toBe(true)
    if (res.ok) {
      expect(res.data.map((s) => [s.id, s.nodeId, s.source, s.detectedTag, s.updatedAt])).toEqual([
        ['s1', NODE_A, 'detected', 'DB-71', TS],
        ['s2', null, 'detected', 'NAME: DELTA KIOSK', TS],
      ])
    }
    expect(inserts()).toHaveLength(1)
    // Never organisation_id / project_id / created_by: the slice-1 triggers bind them.
    expect(inserts()[0]!.payload).toEqual([
      { status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: NODE_A, area_type: null, detected_tag: 'DB-71', source: 'detected' },
      { status_plan_id: PLAN_ID, shape: 'rect', points: RECT, node_id: null, area_type: null, detected_tag: 'NAME: DELTA KIOSK', source: 'detected' },
    ])
    expect(requireEffectiveRoleMock).toHaveBeenCalledWith(client, PROJECT_ID, ORG_WRITE_ROLES)
  })

  it('a refused role gate stops before any write (the gate is an object, not a boolean)', async () => {
    setup({ 'tenants.status_plans:select': [{ data: SCHEMATIC }] })
    requireEffectiveRoleMock.mockResolvedValue({ ok: false, error: 'Your role (contractor) is not allowed' })
    const res = await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' }] })
    expect(res).toEqual({ ok: false, error: 'Only an owner, admin or project manager can change status plans on this project.' })
    expect(inserts()).toEqual([])
  })

  it('refuses a tenant-layout plan', async () => {
    setup({ 'tenants.status_plans:select': [{ data: { ...SCHEMATIC, purpose: 'tenant_layout' } }] })
    const res = await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: null, detectedTag: null }] })
    expect(res).toEqual({ ok: false, error: 'Block detection is only for distribution schematic plans.' })
    expect(inserts()).toEqual([])
  })

  it('a plan the caller cannot see reads as gone', async () => {
    setup({})
    expect(await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: null, detectedTag: null }] }))
      .toEqual({ ok: false, error: 'That plan no longer exists, or you cannot see it. Go back to the list and reload.' })
  })

  it('a signed-out caller is told so', async () => {
    setup({}, null)
    expect(await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: null, detectedTag: null }] }))
      .toEqual({ ok: false, error: 'Your session has ended. Sign in again.' })
  })

  it('refuses the same board twice in one batch before touching the database', async () => {
    const res = await acceptDetectedBlocksAction({
      planId: PLAN_ID,
      blocks: [
        { points: RECT, nodeId: NODE_B, detectedTag: 'DB-1' },
        { points: RECT, nodeId: NODE_B, detectedTag: 'DB-2' },
      ],
    })
    expect(res).toEqual({ ok: false, error: 'Two of these blocks are linked to the same board. A board can appear once on a plan.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('a degenerate (zero-area) rectangle is refused with the outline sentence before touching the database', async () => {
    const flat = [10, 10, 50, 10, 50, 10, 10, 10]
    const res = await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: flat, nodeId: null, detectedTag: 'DB-9' }] })
    expect(res).toEqual({ ok: false, error: 'DB-9: The rectangle has no area — drag it larger. Nothing was added.' })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('refuses malformed input before touching the database', async () => {
    const unreadable = { ok: false, error: 'These blocks could not be read. Run detection again.' }
    expect(await acceptDetectedBlocksAction({ planId: 'not-a-uuid', blocks: [{ points: RECT, nodeId: null, detectedTag: null }] })).toEqual(unreadable)
    expect(await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: [0, 0, 1, 1, 2, 2], nodeId: null, detectedTag: null }] })).toEqual(unreadable)
    expect(await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [] })).toEqual(unreadable)
    expect(await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: null, detectedTag: 'X'.repeat(65) }] })).toEqual(unreadable)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('maps a duplicate-board refusal from the database to a sentence', async () => {
    setup({
      'tenants.status_plans:select': [{ data: SCHEMATIC }],
      'tenants.status_plan_shapes:insert': [{ error: { code: '23505', message: 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"' } }],
    })
    const res = await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' }] })
    expect(res).toEqual({ ok: false, error: 'One of these boards is already on this plan. Nothing was added; run detection again to refresh the list.' })
  })

  it('fewer rows back than sent is not reported as success', async () => {
    setup({
      'tenants.status_plans:select': [{ data: SCHEMATIC }],
      'tenants.status_plan_shapes:insert': [{ data: [] }],
    })
    const res = await acceptDetectedBlocksAction({ planId: PLAN_ID, blocks: [{ points: RECT, nodeId: NODE_A, detectedTag: 'DB-71' }] })
    expect(res.ok).toBe(false)
  })
})
