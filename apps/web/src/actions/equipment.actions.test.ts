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
  createEquipmentNodeAction,
  decommissionEquipmentNodeAction,
} from './equipment.actions'

const UUID = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'

/** Minimal supabase mock: auth.getUser + the effective-role RPC + the
 *  guardNodeBelongsToProject existence check (two chained .eq() on nodes). */
function mockClient(opts: { role?: string | null } = {}) {
  const { role = 'owner' } = opts
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({
            eq: () => ({ maybeSingle: () => Promise.resolve({ data: { id: NODE } }) }),
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

describe('createEquipmentNodeAction — validation', () => {
  it('rejects a non-uuid projectId before any I/O', async () => {
    const res = await createEquipmentNodeAction('not-a-uuid', 'main_board', 'MB-1', '', true)
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects an empty code', async () => {
    const res = await createEquipmentNodeAction(UUID, 'main_board', '', '', true)
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('createEquipmentNodeAction — happy path', () => {
  it('inserts an equipment node + its order and returns the id', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      // 1) node insert → representation [{id}]
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'node-9' }]) })
      // 2) node_orders insert → minimal
      .mockResolvedValueOnce({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createEquipmentNodeAction(UUID, 'main_board', 'MB-1', 'Main DB', true)
    expect(res).toEqual({ id: 'node-9' })
    const nodeBody = JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)
    expect(nodeBody.kind).toBe('main_board')
    // a node_orders POST followed
    expect(fetchMock.mock.calls[1][0]).toContain('/rest/v1/node_orders')
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('treats a duplicate node_orders insert (trigger already created it) as success', async () => {
    createClientMock.mockResolvedValue(mockClient())
    const fetchMock = vi.fn()
      // 1) node insert → representation [{id}]
      .mockResolvedValueOnce({ ok: true, json: () => Promise.resolve([{ id: 'node-9' }]) })
      // 2) node_orders insert → 409 conflict (the 00121 trigger won the race)
      .mockResolvedValueOnce({ ok: false, status: 409, text: () => Promise.resolve('duplicate key value violates unique constraint "idx_node_orders_equipment_unique"') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await createEquipmentNodeAction(UUID, 'main_board', 'MB-1', '', true)
    expect(res).toEqual({ id: 'node-9' })
    expect(revalidatePathMock).toHaveBeenCalled()
  })
})

describe('role gate', () => {
  it('denies create when effective role is not owner/admin/PM, before any write', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'contractor' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await createEquipmentNodeAction(UUID, 'main_board', 'MB-1', '', true)
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('denies decommission when the RPC returns no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await decommissionEquipmentNodeAction(UUID, NODE, 'reason')
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
