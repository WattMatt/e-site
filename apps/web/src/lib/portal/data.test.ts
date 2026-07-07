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
  getPortalEquipmentMaterials,
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

/**
 * Multi-table service-client stub — each .from(table) gets its own chain and
 * data, so a fetcher that reads several tables can be exercised end-to-end
 * while the per-table .select() column lists stay assertable.
 */
function makeMultiTableClient(dataByTable: Record<string, unknown>) {
  const selects: Record<string, string[]> = {}
  const client: any = {
    schema: vi.fn(() => ({
      from: vi.fn((table: string) => {
        const chain: any = {}
        const resolve = () => Promise.resolve({ data: dataByTable[table] ?? [], error: null })
        for (const m of ['eq', 'in', 'is', 'order', 'limit']) chain[m] = vi.fn(() => chain)
        chain.select = vi.fn((cols: string) => {
          ;(selects[table] ??= []).push(cols)
          return chain
        })
        chain.maybeSingle = vi.fn(() =>
          Promise.resolve({ data: dataByTable[table] ?? null, error: null }),
        )
        chain.then = (onOk: any, onErr: any) => resolve().then(onOk, onErr)
        return chain
      }),
    })),
  }
  return { client, selects }
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
    ['getPortalEquipmentMaterials', getPortalEquipmentMaterials],
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
    ['getPortalEquipmentMaterials', getPortalEquipmentMaterials],
  ] as const)('%s returns null for a non-client role', async (_name, fn) => {
    getOrgContextMock.mockResolvedValueOnce({ ...clientCtx, role: 'contractor' })
    expect(await fn(PROJECT_ID)).toBeNull()
    // Never reaches the service client at all.
    expect(createServiceClientMock).not.toHaveBeenCalled()
  })
})

// ─── Equipment & Materials — service read, commercial-free column allow-list ─

describe('getPortalEquipmentMaterials', () => {
  const NODE = {
    id: 'n1', code: 'DB-01', name: 'Main DB', kind: 'main_board', status: 'active',
    coc_required: false, custom_kind_label: null, shop_name: null, shop_number: null,
  }
  const ORDER = {
    id: 'o1', node_id: 'n1', label: 'DB-01', scope_item_type_id: null,
    status: 'ordered', ordered_at: '2026-07-01', received_at: null,
  }
  const tables = () => ({
    projects: { id: PROJECT_ID, organisation_id: ORG_ID, opening_date: '2026-09-01' },
    nodes: [NODE],
    node_orders: [ORDER],
    tenant_details: [],
    scope_item_types: [],
  })

  it('reads via the service client only after the membership gate passes', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const gate = makeQueryClient({ id: 'pm-row' }) // membership check
    const data = makeMultiTableClient(tables())
    createServiceClientMock
      .mockReturnValueOnce(gate.client)
      .mockReturnValueOnce(data.client)
    const groups = await getPortalEquipmentMaterials(PROJECT_ID)
    expect(groups).not.toBeNull()
    expect(groups).toHaveLength(1)
    expect(groups![0].label).toBe('Main Boards')
    expect(groups![0].boards[0].code).toBe('DB-01')
    expect(groups![0].boards[0].lines[0].status).toBe('ordered')
  })

  it('never selects order notes, documents, drawings, or any cost columns', async () => {
    getOrgContextMock.mockResolvedValueOnce(clientCtx)
    const gate = makeQueryClient({ id: 'pm-row' })
    const data = makeMultiTableClient(tables())
    createServiceClientMock
      .mockReturnValueOnce(gate.client)
      .mockReturnValueOnce(data.client)
    await getPortalEquipmentMaterials(PROJECT_ID)
    const all = Object.values(data.selects).flat().join(' ')
    expect(all).not.toMatch(/notes|document|drawing|quote|rate|cost|price|amount|contract_value/i)
    // docs/drawings never even reach the shaping layer.
    const board = (await (async () => {
      getOrgContextMock.mockResolvedValueOnce(clientCtx)
      const g2 = makeQueryClient({ id: 'pm-row' })
      const d2 = makeMultiTableClient(tables())
      createServiceClientMock.mockReturnValueOnce(g2.client).mockReturnValueOnce(d2.client)
      const groups = await getPortalEquipmentMaterials(PROJECT_ID)
      return groups![0].boards[0]
    })())
    expect(board.lines[0].documents).toEqual({ quote: [], order_instruction: [] })
    expect(board.lines[0].shopDrawings).toEqual([])
  })
})
