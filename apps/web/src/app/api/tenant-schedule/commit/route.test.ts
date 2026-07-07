// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env before route.ts module-level consts evaluate.
const { getUserMock, rpcMock, projectResult, roleResult, parseMock, listNodesMock, fetchMock } =
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
      fetchMock: vi.fn(),
    }
  })

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    schema: () => ({
      from: () => ({
        select: () => ({
          eq: () => ({ single: () => Promise.resolve(projectResult.value) }),
          in: () => Promise.resolve({ data: [], error: null }),
        }),
      }),
    }),
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
}))

vi.mock('next/cache', () => ({ revalidatePath: vi.fn() }))

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
  fetchMock.mockReset()
  // Any real service-role write attempt would go through fetch — track it so we
  // can prove an unauthorised caller never reaches the write phase.
  vi.stubGlobal('fetch', fetchMock)
  fetchMock.mockResolvedValue({ ok: true, json: async () => [{ id: 'n1' }], text: async () => '' })
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  projectResult.value = { data: { id: PROJECT_ID, organisation_id: 'o1' }, error: null }
  rpcMock.mockImplementation(async () => roleResult.value)
  parseMock.mockResolvedValue({ rows: [], errors: [], warnings: [] })
  listNodesMock.mockResolvedValue([])
})

describe('POST /api/tenant-schedule/commit — role gate (service-role writes bypass RLS)', () => {
  it('401 when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: null })
    const res = await POST(reqWithFile())
    expect(res.status).toBe(401)
    expect(parseMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403 when the project is not accessible', async () => {
    projectResult.value = { data: null, error: { message: 'no' } }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(parseMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403 for a client_viewer — no parse, NO service-role write', async () => {
    roleResult.value = { data: 'client_viewer', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(parseMock).not.toHaveBeenCalled()
    expect(listNodesMock).not.toHaveBeenCalled()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('403 for a contractor effective role', async () => {
    roleResult.value = { data: 'contractor', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(403)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('proceeds (200) for a project_manager effective role', async () => {
    roleResult.value = { data: 'project_manager', error: null }
    const res = await POST(reqWithFile())
    expect(res.status).toBe(200)
    expect(parseMock).toHaveBeenCalledTimes(1)
  })
})
