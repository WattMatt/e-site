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
  setScopeItemPartyAction,
} from './tenant-scope.actions'

const UUID = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'
const SCOPE = '33333333-3333-3333-3333-333333333333'

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

describe('role gate', () => {
  it('denies setScopeItemParty when the RPC returns no project access (null role)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await setScopeItemPartyAction(UUID, NODE, SCOPE, 'tenant')
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})
