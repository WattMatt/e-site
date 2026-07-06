import { describe, it, expect, vi, beforeEach } from 'vitest'

// ─── Mocks ────────────────────────────────────────────────────────────────────

const { getOrgContextMock, createClientMock, createServiceClientMock } = vi.hoisted(() => ({
  getOrgContextMock: vi.fn(),
  createClientMock: vi.fn(),
  createServiceClientMock: vi.fn(),
}))

vi.mock('@/lib/auth-org', () => ({ getOrgContext: getOrgContextMock }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: createClientMock,
  createServiceClient: createServiceClientMock,
}))

import {
  requirePortalAccess,
  listPortalProjects,
  listPortalCableRevisions,
  listPortalGcrReports,
  listPortalInspections,
} from './data'

const PROJECT_ID = '11111111-1111-1111-1111-111111111111'
const USER_ID = '22222222-2222-2222-2222-222222222222'
const ORG_ID = '33333333-3333-3333-3333-333333333333'

/**
 * Chainable query stub that records every .select() argument and resolves any
 * await with { data }. Lets tests assert on the exact columns requested —
 * the portal's column allow-lists are a security control.
 */
function makeQueryClient(data: unknown = []) {
  const selects: string[] = []
  const chain: any = {}
  const resolve = () => Promise.resolve({ data, error: null })
  for (const m of ['from', 'eq', 'order', 'limit']) {
    chain[m] = vi.fn(() => chain)
  }
  chain.select = vi.fn((cols: string) => { selects.push(cols); return chain })
  chain.maybeSingle = vi.fn(() => resolve())
  chain.then = (onOk: any, onErr: any) => resolve().then(onOk, onErr)
  // The chain is thenable (queries are awaited), so the CLIENT itself must be
  // a separate non-thenable object — `await createClient()` would otherwise
  // unwrap the chain. `.eq` is exposed on the root only via chain re-entry.
  const client: any = { schema: vi.fn(() => chain), eq: chain.eq }
  return { client, chain, selects }
}

const clientCtx = { userId: USER_ID, organisationId: ORG_ID, role: 'client_viewer' }

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── requirePortalAccess — the portal's gate ─────────────────────────────────

describe('requirePortalAccess', () => {
  it('denies when not authenticated', async () => {
    getOrgContextMock.mockResolvedValueOnce(null)
    expect(await requirePortalAccess(PROJECT_ID)).toBeNull()
  })

  it.each(['owner', 'admin', 'project_manager', 'contractor', 'inspector', 'supplier'])(
    'denies %s — the portal is exclusively for client_viewer',
    async (role) => {
      getOrgContextMock.mockResolvedValueOnce({ ...clientCtx, role })
      expect(await requirePortalAccess(PROJECT_ID)).toBeNull()
    },
  )

  it('denies a client_viewer with NO active membership on the project', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const { client } = makeQueryClient(null) // maybeSingle → no row
    createServiceClientMock.mockReturnValueOnce(client)
    expect(await requirePortalAccess(PROJECT_ID)).toBeNull()
  })

  it('grants a client_viewer with an active project membership', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const { client } = makeQueryClient({ id: 'pm-row' })
    createServiceClientMock.mockReturnValueOnce(client)
    expect(await requirePortalAccess(PROJECT_ID)).toEqual({
      userId: USER_ID,
      organisationId: ORG_ID,
      projectId: PROJECT_ID,
    })
    // Membership check filters on active rows for THIS project + user.
    expect(client.eq).toHaveBeenCalledWith('project_id', PROJECT_ID)
    expect(client.eq).toHaveBeenCalledWith('user_id', USER_ID)
    expect(client.eq).toHaveBeenCalledWith('is_active', true)
  })
})

// ─── Column allow-lists — financials must never be selected ─────────────────

describe('column allow-lists', () => {
  it('project list never selects contract_value or currency', async () => {
    const { client, selects } = makeQueryClient([])
    createClientMock.mockResolvedValueOnce(client)
    await listPortalProjects()
    expect(selects.join(' ')).not.toMatch(/contract_value|currency/)
  })

  it('cable revisions select technical columns only — no rate/cost fields', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const gate = makeQueryClient({ id: 'pm-row' })
    const query = makeQueryClient([])
    createServiceClientMock
      .mockReturnValueOnce(gate.client)   // membership check
      .mockReturnValueOnce(query.client)  // data read
    await listPortalCableRevisions(PROJECT_ID)
    const cols = query.selects.join(' ')
    expect(cols).not.toMatch(/rate|cost|price|amount/i)
    expect(cols).toContain('code')
    expect(cols).toContain('status')
  })

  it('gcr report list selects metadata only', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const gate = makeQueryClient({ id: 'pm-row' })
    const query = makeQueryClient([])
    createServiceClientMock
      .mockReturnValueOnce(gate.client)
      .mockReturnValueOnce(query.client)
    await listPortalGcrReports(PROJECT_ID)
    const cols = query.selects.join(' ')
    expect(cols).not.toMatch(/summary|storage_path|capital|tariff/i)
    expect(cols).toContain('revision_number')
  })
})

// ─── Service-read aspects refuse to fetch without the gate ──────────────────

describe('curated service reads', () => {
  it.each([
    ['listPortalInspections', listPortalInspections],
    ['listPortalCableRevisions', listPortalCableRevisions],
    ['listPortalGcrReports', listPortalGcrReports],
  ] as const)('%s returns null (→ 404) for a non-member', async (_name, fn) => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const gate = makeQueryClient(null) // no membership row
    createServiceClientMock.mockReturnValueOnce(gate.client)
    expect(await fn(PROJECT_ID)).toBeNull()
  })

  it.each([
    ['listPortalInspections', listPortalInspections],
    ['listPortalCableRevisions', listPortalCableRevisions],
    ['listPortalGcrReports', listPortalGcrReports],
  ] as const)('%s returns null for a non-client role', async (_name, fn) => {
    getOrgContextMock.mockResolvedValueOnce({ ...clientCtx, role: 'contractor' })
    expect(await fn(PROJECT_ID)).toBeNull()
    // Never reaches the service client at all.
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})
