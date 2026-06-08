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

import { getTenantDeleteSummaryAction, hardDeleteTenantAction } from './tenant-delete.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'

/**
 * Per-(schema, table) read responses. Each entry is the resolved value the
 * action's `.select()...` chain (or its `.maybeSingle()`) should produce.
 *
 * Reads in the SUT come in two shapes:
 *   - list reads  → `await query`           → resolves { data: [...] }
 *   - single reads→ `await query.maybeSingle()` → resolves { data: {...}|null }
 * A single thenable supports both: it is awaitable AND carries .maybeSingle().
 */
type ReadRow = Record<string, unknown>
interface ReadConfig {
  // structure.nodes is read twice: the kind/code/name assert (maybeSingle) and
  // the child-node blocker (list). Key the kind read as 'nodes:self', the
  // child read as 'nodes:children'. The SUT distinguishes them by selected cols.
  'nodes:self'?: ReadRow | null
  'nodes:children'?: ReadRow[]
  'tenant_scope_items'?: ReadRow[]
  'tenant_documents'?: ReadRow[]
  'tenant_document_revisions'?: ReadRow[]
  'tenant_units'?: ReadRow[]
  'node_orders'?: ReadRow[]
  'node_order_shop_drawings'?: ReadRow[]
  'node_order_documents'?: ReadRow[]
  'supplies'?: ReadRow[] // cable_schedule.supplies (with joined revision.status)
  'inspections'?: ReadRow[] // inspections.inspections targeting the node
}

function makeQuery(rows: ReadRow[]) {
  // A thenable + maybeSingle, so both `await q` and `await q.maybeSingle()` work.
  const result = { data: rows, error: null }
  const single = { data: rows[0] ?? null, error: null }
  const q: any = {
    select: () => q,
    eq: () => q,
    is: () => q,
    or: () => q,
    in: () => q,
    order: () => q,
    neq: () => q,
    maybeSingle: () => Promise.resolve(single),
    then: (resolve: (v: typeof result) => unknown) => resolve(result),
  }
  return q
}

function mockClient(cfg: ReadConfig & { role?: string | null } = {}) {
  const { role = 'owner' } = cfg
  const removeSpy = vi.fn().mockResolvedValue({ data: [], error: null })
  const client: any = {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    storage: { from: () => ({ remove: removeSpy }) },
    schema: (_schema: string) => ({
      from: (table: string) => {
        if (table === 'nodes') {
          // Disambiguate the two nodes reads by the select() arg the SUT passes:
          // the self/kind assert selects 'kind' (e.g. 'id, kind, code, name, status');
          // the child-node blocker selects only 'id' (filtered by parent_node_id).
          return {
            select: (cols: string) => {
              const isSelfRead = cols.includes('kind')
              const rows = isSelfRead
                ? (cfg['nodes:self'] ? [cfg['nodes:self']] : [])
                : (cfg['nodes:children'] ?? [])
              return makeQuery(rows)
            },
          }
        }
        const key = table as keyof ReadConfig
        const rows = (cfg[key] as ReadRow[] | undefined) ?? []
        return makeQuery(rows)
      },
    }),
    __removeSpy: removeSpy,
  }
  return client
}

beforeEach(() => {
  createClientMock.mockReset()
  revalidatePathMock.mockReset()
  getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

// ---------------------------------------------------------------------------
// Role gate
// ---------------------------------------------------------------------------

describe('role gate', () => {
  it('hardDeleteTenantAction denies a non-write role before any fetch', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ role: 'contractor', 'nodes:self': { id: NODE, kind: 'tenant_db', code: 'T1', name: 'Shop 1', status: 'active' } }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await hardDeleteTenantAction(PROJECT, NODE)
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('getTenantDeleteSummaryAction denies a null-role (no project access)', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const res = await getTenantDeleteSummaryAction(PROJECT, NODE)
    expect('error' in res).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Summary — blockers
// ---------------------------------------------------------------------------

describe('getTenantDeleteSummaryAction — blockers', () => {
  it('returns { blocked } when an issued-revision supply references the node', async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        'nodes:self': { id: NODE, kind: 'tenant_db', code: 'T1', name: 'Shop 1', status: 'active' },
        // an issued (status != 'DRAFT') supply referencing the node
        supplies: [{ id: 's-1', revision: { status: 'ISSUED' } }],
      }),
    )
    const res = await getTenantDeleteSummaryAction(PROJECT, NODE)
    expect(res).toMatchObject({ blocked: true })
    if ('blocked' in res) expect(res.reason.toLowerCase()).toContain('issued')
  })

  it('returns { blocked } when a child node exists', async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        'nodes:self': { id: NODE, kind: 'tenant_db', code: 'T1', name: 'Shop 1', status: 'active' },
        'nodes:children': [{ id: 'child-1' }],
      }),
    )
    const res = await getTenantDeleteSummaryAction(PROJECT, NODE)
    expect(res).toMatchObject({ blocked: true })
  })

  it('rejects a node that is not a tenant_db', async () => {
    createClientMock.mockResolvedValue(
      mockClient({ 'nodes:self': { id: NODE, kind: 'main_board', code: 'MB1', name: null, status: 'active' } }),
    )
    const res = await getTenantDeleteSummaryAction(PROJECT, NODE)
    expect('error' in res).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Summary — happy path counts
// ---------------------------------------------------------------------------

describe('getTenantDeleteSummaryAction — counts', () => {
  it('returns the code/name + counts when nothing blocks', async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        'nodes:self': { id: NODE, kind: 'tenant_db', code: 'SHOP-12', name: 'Shoprite', status: 'active' },
        'nodes:children': [],
        supplies: [{ id: 's-1', revision: { status: 'DRAFT' } }], // a draft supply — not a blocker, counted
        tenant_scope_items: [{ id: 'sc-1' }, { id: 'sc-2' }],
        tenant_documents: [{ id: 'd-1' }],
        tenant_document_revisions: [{ id: 'r-1', storage_path: 'a' }, { id: 'r-2', storage_path: 'b' }],
        tenant_units: [{ id: 'u-1' }],
        node_orders: [{ id: 'o-1' }],
        node_order_shop_drawings: [{ id: 'sd-1', storage_path: 'sd', handover_document_id: null }],
        node_order_documents: [{ id: 'od-1', storage_path: 'od' }],
        inspections: [{ id: 'i-1' }],
      }),
    )
    const res = await getTenantDeleteSummaryAction(PROJECT, NODE)
    expect('ok' in res).toBe(true)
    if ('ok' in res) {
      expect(res.code).toBe('SHOP-12')
      expect(res.name).toBe('Shoprite')
      expect(res.counts.scopeItems).toBe(2)
      expect(res.counts.documents).toBe(1)
      expect(res.counts.documentRevisions).toBe(2)
      expect(res.counts.units).toBe(1)
      expect(res.counts.orders).toBe(1)
      expect(res.counts.shopDrawings).toBe(1)
      expect(res.counts.orderDocuments).toBe(1)
      expect(res.counts.cableSupplies).toBe(1)
      expect(res.counts.inspectionsTargeting).toBe(1)
      // storageFiles = revisions(2) + orderDocs(1) + shopDrawings(1) + handover(0) = 4
      expect(res.counts.storageFiles).toBe(4)
    }
  })
})

// ---------------------------------------------------------------------------
// hardDeleteTenantAction — orchestration
// ---------------------------------------------------------------------------

describe('hardDeleteTenantAction — happy path orchestration', () => {
  it('issues supply deletes → node delete → handover-doc delete, then storage removes, in order', async () => {
    const client = mockClient({
      role: 'owner',
      'nodes:self': { id: NODE, kind: 'tenant_db', code: 'SHOP-12', name: 'Shoprite', status: 'active' },
      'nodes:children': [],
      supplies: [{ id: 's-1', revision: { status: 'DRAFT' } }],
      tenant_documents: [{ id: 'd-1' }],
      tenant_document_revisions: [{ id: 'r-1', storage_path: 'tdocs/a.pdf' }],
      node_orders: [{ id: 'o-1' }],
      node_order_documents: [{ id: 'od-1', storage_path: 'nod/x.pdf' }],
      node_order_shop_drawings: [
        { id: 'sd-1', storage_path: 'nod/d.pdf', handover_document_id: 'hand-1' },
      ],
      // handover tenants.documents row resolved for hand-1
      inspections: [],
    })
    // tenants.documents read for handover paths/ids — route via schema('tenants')
    // The SUT reads tenants.documents (id, storage_path) for the handover ids.
    const originalSchema = client.schema
    client.schema = (schema: string) => {
      if (schema === 'tenants') {
        return {
          from: (table: string) => {
            if (table === 'documents') {
              return makeQuery([{ id: 'hand-1', storage_path: 'pdocs/h.pdf' }])
            }
            return makeQuery([])
          },
        }
      }
      return originalSchema(schema)
    }
    createClientMock.mockResolvedValue(client)

    const calls: Array<{ url: string; method: string }> = []
    const fetchMock = vi.fn((url: string, init: RequestInit) => {
      calls.push({ url, method: (init.method as string) ?? 'GET' })
      return Promise.resolve({ ok: true, text: () => Promise.resolve('') })
    })
    vi.stubGlobal('fetch', fetchMock)

    const res = await hardDeleteTenantAction(PROJECT, NODE)
    expect(res).toEqual({ ok: true })

    const deletes = calls.filter((c) => c.method === 'DELETE')
    // Expected DELETE order: supplies(from) → supplies(to) → structure.nodes →
    // handover tenants.documents. The FK-less handover rows are deleted AFTER the
    // node so a mid-failure can't orphan them while drawings still reference them.
    expect(deletes.length).toBeGreaterThanOrEqual(4)
    const idxFrom = deletes.findIndex((c) => c.url.includes('/rest/v1/supplies') && c.url.includes('from_node_id'))
    const idxTo = deletes.findIndex((c) => c.url.includes('/rest/v1/supplies') && c.url.includes('to_node_id'))
    const idxNode = deletes.findIndex((c) => c.url.includes('/rest/v1/nodes') && c.url.includes(`id=eq.${NODE}`))
    const idxHandover = deletes.findIndex((c) => c.url.includes('/rest/v1/documents') && c.url.includes('hand-1'))
    expect(idxFrom).toBeGreaterThanOrEqual(0)
    expect(idxTo).toBeGreaterThanOrEqual(0)
    expect(idxNode).toBeGreaterThan(idxFrom)
    expect(idxNode).toBeGreaterThan(idxTo)
    expect(idxHandover).toBeGreaterThan(idxNode)

    // storage removes happen AFTER the node delete (best-effort)
    expect(client.__removeSpy).toHaveBeenCalled()
    expect(revalidatePathMock).toHaveBeenCalled()
  })

  it('re-checks blockers and refuses when an issued supply is present', async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        role: 'owner',
        'nodes:self': { id: NODE, kind: 'tenant_db', code: 'T1', name: null, status: 'active' },
        supplies: [{ id: 's-1', revision: { status: 'ISSUED' } }],
      }),
    )
    const fetchMock = vi.fn(() => Promise.resolve({ ok: true, text: () => Promise.resolve('') }))
    vi.stubGlobal('fetch', fetchMock)

    const res = await hardDeleteTenantAction(PROJECT, NODE)
    expect('error' in res).toBe(true)
    // no node DELETE should have fired
    expect(fetchMock.mock.calls.every((c: any[]) => !String(c[0]).includes('/rest/v1/nodes') || (c[1] as RequestInit).method !== 'DELETE')).toBe(true)
  })
})
