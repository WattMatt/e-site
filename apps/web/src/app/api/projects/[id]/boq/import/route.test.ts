// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { rpcMock, serviceMock, requireRoleAPIMock } = vi.hoisted(() => ({
  rpcMock: vi.fn(),
  serviceMock: vi.fn(),
  requireRoleAPIMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: rpcMock }),
  createServiceClient: () => serviceMock(),
}))
vi.mock('@/lib/auth/require-role', () => ({ requireRoleAPI: (...a: unknown[]) => requireRoleAPIMock(...a) }))
vi.mock('@/lib/boq/parse-boq-xlsx', () => ({ parseBoqXlsx: vi.fn() }))
vi.mock('@/lib/boq/reconcile', () => ({ reconcile: vi.fn() }))

import { POST } from './route'

const call = () => POST({} as never, { params: Promise.resolve({ id: 'p-foreign' }) })

beforeEach(() => {
  rpcMock.mockReset(); serviceMock.mockReset(); requireRoleAPIMock.mockReset()
})

describe('POST /api/projects/[id]/boq/import — site scope', () => {
  it('404s a caller without access to the project before touching the service key', async () => {
    rpcMock.mockResolvedValue({ data: false, error: null })
    const res = await call()
    expect(res.status).toBe(404)
    expect(rpcMock).toHaveBeenCalledWith('user_has_project_access', { _project_id: 'p-foreign' })
    expect(serviceMock).not.toHaveBeenCalled()
    expect(requireRoleAPIMock).not.toHaveBeenCalled()
  })

  it('reaches the role gate once the caller has access', async () => {
    rpcMock.mockResolvedValue({ data: true, error: null })
    const maybeSingle = vi.fn().mockResolvedValue({ data: { id: 'p-foreign', organisation_id: 'o1' }, error: null })
    serviceMock.mockReturnValue({ schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle }) }) }) }) })
    const denied = new Response(null, { status: 403 })
    requireRoleAPIMock.mockResolvedValue({ ok: false, response: denied })
    const res = await call()
    expect(requireRoleAPIMock).toHaveBeenCalledWith(expect.anything(), 'o1')
    expect(res.status).toBe(403)
  })
})
