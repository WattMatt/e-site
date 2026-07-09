// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

const { createClientMock, getByIdMock } = vi.hoisted(() => ({
  createClientMock: vi.fn(),
  getByIdMock: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
vi.mock('@esite/shared', async () => {
  const actual = await vi.importActual<any>('@esite/shared')
  return { ...actual, projectService: { ...actual.projectService, getById: getByIdMock } }
})

import { GET } from './route'

const NODE = '22222222-2222-2222-2222-222222222222'

function req(qs: string) {
  return new NextRequest(`https://app.test/api/tenant-schedule/legend-card/pdf?${qs}`)
}

/** node: row returned for structure.nodes; details/circuits for the other tables. */
function mockClient(opts: {
  user?: boolean
  node?: Record<string, unknown> | null
  details?: Record<string, unknown> | null
  circuits?: Array<Record<string, unknown>>
} = {}) {
  const { user = true, node = baseNode(), details = null, circuits = [] } = opts
  function thenable(t: string) {
    const q: any = {
      select: () => q, eq: () => q, order: () => q,
      maybeSingle: () => Promise.resolve({ data: t === 'nodes' ? node : details }),
      then: (resolve: (v: unknown) => void) => resolve({ data: circuits, error: null }),
    }
    return q
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: user ? { id: 'u-1' } : null } }) },
    schema: () => ({
      from: (t: string) => thenable(t),
    }),
  }
}

function baseNode() {
  return {
    id: NODE, project_id: '11111111-1111-1111-1111-111111111111', code: 'DB-12A', kind: 'tenant_db',
    shop_number: '12A', shop_name: 'Test Tenant',
    breaker_rating_a: 63, pole_config: 'TP', incomer_breaker_a: null, incomer_pole_config: null,
  }
}

beforeEach(() => {
  createClientMock.mockReset(); getByIdMock.mockReset()
  createClientMock.mockResolvedValue(mockClient())
  getByIdMock.mockResolvedValue({ id: 'p-1', name: 'KINGSWALK', organisation_id: 'org-1' })
})

describe('GET /api/tenant-schedule/legend-card/pdf', () => {
  it('401s when unauthenticated', async () => {
    createClientMock.mockResolvedValue(mockClient({ user: false }))
    const res = await GET(req(`nodeId=${NODE}`))
    expect(res.status).toBe(401)
  })

  it('400s on a malformed nodeId', async () => {
    const res = await GET(req('nodeId=not-a-uuid'))
    expect(res.status).toBe(400)
  })

  it('404s when the node is not visible (RLS) or not a tenant_db', async () => {
    createClientMock.mockResolvedValue(mockClient({ node: null }))
    const res = await GET(req(`nodeId=${NODE}`))
    expect(res.status).toBe(404)
  })

  it('returns a PDF attachment for a visible tenant node', async () => {
    const res = await GET(req(`nodeId=${NODE}&size=A5`))
    expect(res.status).toBe(200)
    expect(res.headers.get('Content-Type')).toBe('application/pdf')
    expect(res.headers.get('Content-Disposition')).toContain('legend-card-12A.pdf')
  })
})
