// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env must be set before route.ts evaluates its module-level consts (MAX_BYTES
// etc.). vi.hoisted runs before the hoisted import below.
const { getUserMock, rpcMock, projectResult, roleResult, parseMock, listNodesMock } =
  vi.hoisted(() => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
    return {
      getUserMock: vi.fn(),
      rpcMock: vi.fn(),
      projectResult: { value: { data: null as any, error: null as any } },
      roleResult: { value: { data: null as any, error: null as any } },
      parseMock: vi.fn(),
      listNodesMock: vi.fn(),
    }
  })

// The route's createClient — one fake client serves auth.getUser (used by the
// route AND by the real requireEffectiveRole), the projects.projects access
// read, and the user_effective_project_role RPC (the actual gate under test).
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve(projectResult.value) }),
        }),
      }),
    }),
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
}))

// Keep ORG_WRITE_ROLES + diffTenantSchedule real; stub only the I/O helpers so
// an authorised pass-through does no real parsing / DB reads.
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<typeof import('@esite/shared')>('@esite/shared')
  return {
    ...actual,
    parseTenantSchedule: (...a: unknown[]) => parseMock(...a),
    listNodes: (...a: unknown[]) => listNodesMock(...a),
  }
})

import { POST } from './route'

const PROJECT_ID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'

function reqWithFile(projectId: string | null = PROJECT_ID) {
  const form = new FormData()
  if (projectId !== null) form.set('projectId', projectId)
  form.set('file', new File([Buffer.from('x')], 'schedule.xlsx'))
  return { formData: async () => form } as unknown as Request
}

beforeEach(() => {
  getUserMock.mockReset()
  rpcMock.mockReset()
  parseMock.mockReset()
  listNodesMock.mockReset()
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  projectResult.value = { data: { id: PROJECT_ID, organisation_id: 'o1', name: 'P' }, error: null }
  // requireEffectiveRole reads the RPC result.
  rpcMock.mockImplementation(async () => roleResult.value)
  parseMock.mockResolvedValue({ rows: [], errors: [], warnings: [] })
  listNodesMock.mockResolvedValue([])
})

describe('POST /api/tenant-schedule/parse — role gate', () => {
  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(reqWithFile())
    expect(res.status).toBe(401)
    expect(parseMock).not.toHaveBeenCalled()
  })

  it('403 when the project is not accessible', async () => {
    projectResult.value = { data: null, error: { message: 'no' } }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(parseMock).not.toHaveBeenCalled()
  })

  it('403 for a client_viewer (read-only) effective role — never parses', async () => {
    roleResult.value = { data: 'client_viewer', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(parseMock).not.toHaveBeenCalled()
    expect(listNodesMock).not.toHaveBeenCalled()
  })

  it('403 for a contractor effective role (write, but not ORG_WRITE_ROLES)', async () => {
    roleResult.value = { data: 'contractor', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(parseMock).not.toHaveBeenCalled()
  })

  it('proceeds (200) for a project_manager effective role', async () => {
    roleResult.value = { data: 'project_manager', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(200)
    expect(parseMock).toHaveBeenCalledTimes(1)
  })

  it('proceeds (200) for an owner effective role', async () => {
    roleResult.value = { data: 'owner', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(200)
    expect(parseMock).toHaveBeenCalledTimes(1)
  })
})
