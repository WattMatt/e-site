import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getByIdMock, createClientMock, revalidatePathMock } = vi.hoisted(() => ({
  getByIdMock: vi.fn(),
  createClientMock: vi.fn(),
  revalidatePathMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('next/cache', () => ({ revalidatePath: revalidatePathMock, revalidateTag: vi.fn() }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import {
  createSubBoardAction,
  createConcessionAction,
  addTenantUnitAction,
  updateTenantUnitAction,
  deleteTenantUnitAction,
} from './tenant-board.actions'

const UUID = '11111111-1111-1111-1111-111111111111'
const PARENT = '22222222-2222-2222-2222-222222222222'

/** Minimal supabase mock: auth.getUser + the effective-role RPC + the structure
 *  existence checks (two .eq() for nodes; one .eq() for tenant_units). */
function mockClient(opts: { role?: string | null; unitNodeId?: string | null } = {}) {
  const { role = 'owner', unitNodeId = PARENT } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: PARENT } }) }),
            maybeSingle: () => Promise.resolve({ data: unitNodeId ? { node_id: unitNodeId } : null }),
          }),
        }),
      }),
    }),
  }
}

beforeEach(() => {
  createClientMock.mockReset(); revalidatePathMock.mockReset(); getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('createSubBoardAction — validation', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    const res = await createSubBoardAction('not-a-uuid', PARENT, 'SB-1')
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects an empty code', async () => {
    const res = await createSubBoardAction(UUID, PARENT, '')
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('createSubBoardAction — happy path', () => {
  it('inserts a sub_board node + its order and returns the id', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      // 1) node insert → representation [{id}]
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'node-9' }]) })
      // 2) node_orders insert → minimal
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createSubBoardAction(UUID, PARENT, 'SB-1', 'Butchery DB')
    expect(res).toEqual({ id: 'node-9' })
    // node POST body carries kind + parent_node_id
    const nodeBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(nodeBody.kind).toBe('sub_board')
    expect(nodeBody.parent_node_id).toBe(PARENT)
    // a node_orders POST followed
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/node_orders')
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('surfaces a friendly message on a duplicate code', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('duplicate key value') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createSubBoardAction(UUID, PARENT, 'SB-1')
    expect(res).toEqual({ error: expect.stringContaining('already in use') })
  })
})

describe('createConcessionAction — happy path', () => {
  it('inserts a tenant_db node + a tenant_details row', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'con-1' }]) }) // node
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })                // tenant_details
    vi.stubGlobal('fetch', fetchMock)

    const res = await createConcessionAction(UUID, PARENT, 'SHOP-12', 'Coffee Kiosk', 'CON-1')
    expect(res).toEqual({ id: 'con-1' })
    const nodeBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(nodeBody.kind).toBe('tenant_db')
    expect(nodeBody.parent_node_id).toBe(PARENT)
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/tenant_details')
  })

  it('rejects a missing shop number', async () => {
    const res = await createConcessionAction(UUID, PARENT, '', 'x', 'CON-1')
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('addTenantUnitAction', () => {
  it('rejects a non-positive area before any I/O', async () => {
    const res = await addTenantUnitAction(UUID, PARENT, 'U-1', -5)
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('inserts a tenant_units row and returns ok', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await addTenantUnitAction(UUID, PARENT, 'UNIT-13', 250)
    expect(res).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/tenant_units')
    const body = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(body.node_id).toBe(PARENT)
    expect(body.area_m2).toBe(250)
  })
})

describe('role gate (C1)', () => {
  it('denies a caller whose effective role is not owner/admin/PM, before any write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await createSubBoardAction(UUID, PARENT, 'SB-1')
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('denies when the RPC returns no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await createConcessionAction(UUID, PARENT, 'SHOP-1', 'x', 'CON-1')
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('tenant_units update / delete guards (M1)', () => {
  it('update patches the unit after the ownership guard passes', async () => {
    const fetchMock = vi.fn().mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateTenantUnitAction(UUID, PARENT, 'Bay 2', 300)
    expect(res).toEqual({ ok: true })
    expect(fetchMock.mock.calls[0][0]).toContain('/rest/v1/tenant_units')
    expect((fetchMock.mock.calls[0][1] as RequestInit).method).toBe('PATCH')
  })

  it('delete fails closed when the unit does not belong to the project', async () => {
    createClientMock.mockResolvedValue(mockClient({ unitNodeId: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await deleteTenantUnitAction(UUID, 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa')
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
