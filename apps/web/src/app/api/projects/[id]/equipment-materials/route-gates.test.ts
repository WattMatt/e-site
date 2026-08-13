// @vitest-environment node
/**
 * Both the preview and the save route must gate on ORG_WRITE_ROLES.
 *
 * The saved PDF prints order notes and quote/order-instruction status, which the
 * client portal deliberately withholds. Preview streams byte-identical content,
 * so a gate on the save route alone would be theatre — these tests hold both.
 *
 * requireEffectiveRole is kept REAL and driven through the user_effective_project_role
 * RPC, so this exercises the actual gate rather than a stub of it.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const { getUserMock, rpcMock, loadMock, uploadMock, insertResult, removeMock } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  return {
    getUserMock: vi.fn(),
    rpcMock: vi.fn(),
    loadMock: vi.fn(),
    uploadMock: vi.fn(),
    insertResult: { value: { data: { id: 'rep-1', version: 1 }, error: null } as any },
    removeMock: vi.fn(),
  }
})

/** Minimal chainable stand-in for the service client used by the save route. */
function makeServiceClient() {
  const table = (name: string) => {
    const chain: any = {
      select: () => chain,
      eq: () => chain,
      neq: () => chain,
      order: () => chain,
      limit: () => chain,
      update: () => chain,
      maybeSingle: async () =>
        name === 'projects'
          ? { data: { organisation_id: 'org-1' }, error: null }
          : { data: null, error: null }, // no prior issued version
      single: async () => insertResult.value,
      insert: () => chain,
      then: undefined,
    }
    return chain
  }
  return {
    schema: () => ({ from: (n: string) => table(n) }),
    from: (n: string) => table(n),
    storage: {
      from: () => ({
        upload: (...a: unknown[]) => uploadMock(...a),
        remove: (...a: unknown[]) => removeMock(...a),
      }),
    },
  }
}

vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({
    auth: { getUser: getUserMock },
    rpc: (...a: unknown[]) => rpcMock(...a),
  }),
  createServiceClient: () => makeServiceClient(),
}))

// Keep the gate and the compute real; stub only the DB read.
vi.mock('@/lib/equipment-materials/load', () => ({
  loadEquipmentMaterialsData: (...a: unknown[]) => loadMock(...a),
}))

import { GET } from './report-preview/route'
import { POST } from './reports/route'

const PROJECT_ID = '9c1a98b5-6ef3-4388-865f-417d3f5d7465'
const params = { params: Promise.resolve({ id: PROJECT_ID }) }
const req = () => ({ json: async () => ({}) }) as unknown as any

function setRole(role: string | null) {
  rpcMock.mockResolvedValue({ data: role, error: null })
}

beforeEach(() => {
  vi.clearAllMocks()
  getUserMock.mockResolvedValue({ data: { user: { id: 'user-1' } } })
  uploadMock.mockResolvedValue({ error: null })
  insertResult.value = { data: { id: 'rep-1', version: 1 }, error: null }
  loadMock.mockResolvedValue({
    project: { id: PROJECT_ID, name: 'KINGSWALK', organisationId: 'org-1', openingDate: null },
    gatherInput: {
      nodes: [], orders: [], scopeTypeById: new Map(), boByNode: new Map(),
      openingDate: null, today: '2026-08-13', docsByOrder: new Map(), drawingsByOrder: new Map(),
    },
    existingCodes: [], existingCustomTypes: [], decommissionedCount: 0, loadError: null,
  })
})

const DENIED = ['client_viewer', 'contractor', 'inspector', 'supplier']
const ALLOWED = ['owner', 'admin', 'project_manager']

describe('GET report-preview — role gate', () => {
  it('401s when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await GET(req(), params)
    expect(res.status).toBe(401)
  })

  it.each(DENIED)('403s a %s', async (role) => {
    setRole(role)
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
  })

  it('403s a user with no role on the project', async () => {
    setRole(null)
    const res = await GET(req(), params)
    expect(res.status).toBe(403)
  })

  it.each(ALLOWED)('streams a PDF for a %s', async (role) => {
    setRole(role)
    const res = await GET(req(), params)
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
  }, 60_000)
})

describe('POST reports — role gate', () => {
  it('401s when unauthenticated', async () => {
    getUserMock.mockResolvedValue({ data: { user: null } })
    const res = await POST(req(), params)
    expect(res.status).toBe(401)
  })

  it.each(DENIED)('403s a %s and saves nothing', async (role) => {
    setRole(role)
    const res = await POST(req(), params)
    expect(res.status).toBe(403)
    expect(uploadMock).not.toHaveBeenCalled()
  })

  it.each(ALLOWED)('saves a version for a %s', async (role) => {
    setRole(role)
    const res = await POST(req(), params)
    expect(res.status).toBe(201)
    expect(await res.json()).toEqual({ reportId: 'rep-1', version: 1 })
    expect(uploadMock).toHaveBeenCalledOnce()
  }, 60_000)

  it('removes the uploaded object when the row insert fails', async () => {
    setRole('admin')
    insertResult.value = { data: null, error: { message: 'boom' } }
    const res = await POST(req(), params)
    expect(res.status).toBe(500)
    expect(removeMock).toHaveBeenCalledOnce()
  }, 60_000)
})
