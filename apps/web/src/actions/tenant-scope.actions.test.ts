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
  setScopeNotRequiredAction,
  addScopeItemTypeAction,
} from './tenant-scope.actions'

const UUID = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'
const SCOPE = '33333333-3333-3333-3333-333333333333'
const ORG = '44444444-4444-4444-4444-444444444444'

/** Per-table read results for the RLS-gated cookie client:
 *  nodes existence check, scope_item_types label / max-sort_order probes,
 *  node_orders existing-status read (null = no order yet). */
function queryResult(table: string, select: string): { data: unknown; error: null } {
  if (table === 'nodes') return { data: { id: NODE }, error: null }
  if (table === 'scope_item_types' && select === 'label') return { data: { label: 'Shopfront' }, error: null }
  return { data: null, error: null }
}

/** Minimal supabase mock: auth.getUser + the effective-role RPC + chainable
 *  .schema().from().select().eq()/.order()/.limit().maybeSingle() reads. */
function mockClient(opts: { role?: string | null } = {}) {
  const { role = 'owner' } = opts
  const builder = (table: string, select: string) => {
    const chain: Record<string, unknown> = {}
    chain.eq = () => chain
    chain.order = () => chain
    chain.limit = () => chain
    chain.maybeSingle = () => Promise.resolve(queryResult(table, select))
    return chain
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: (table: string) => ({ select: (cols: string) => builder(table, cols) }),
    }),
  }
}

function okFetch(payload: unknown = [{ id: SCOPE }]) {
  return vi.fn().mockResolvedValue({
    ok: true,
    status: 201,
    json: () => Promise.resolve(payload),
    text: () => Promise.resolve(''),
  })
}

beforeEach(() => {
  createClientMock.mockReset(); revalidatePathMock.mockReset(); getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: ORG })
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

// PostgREST only performs the ON CONFLICT upsert when the Prefer
// resolution directive arrives as a real HTTP header — on_conflict alone just
// names the conflict target, and a Prefer= query param is silently ignored.
// These are regression guards for the 409-on-existing-row bug.
describe('setScopeNotRequiredAction upsert', () => {
  it('POSTs tenant_details with Prefer: resolution=merge-duplicates so an existing row updates instead of 409ing', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await setScopeNotRequiredAction(UUID, NODE, true)
    expect(res).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/rest/v1/tenant_details')
    expect(String(url)).toContain('on_conflict=node_id')
    expect(JSON.parse(init.body as string)).toEqual({ node_id: NODE, scope_not_required: true })
    const prefer = (init.headers as Record<string, string>)['Prefer']
    expect(prefer).toContain('resolution=merge-duplicates')
    expect(prefer).toContain('return=representation')
  })
})

describe('addScopeItemTypeAction upsert', () => {
  it('sends the resolution directive as a Prefer header, not a query param', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await addScopeItemTypeAction(UUID, ORG, 'shopfront', 'Shopfront')
    expect(res).toMatchObject({ ok: true, id: SCOPE })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/rest/v1/scope_item_types')
    expect(String(url)).toContain('on_conflict=organisation_id%2Ckey')
    expect(String(url)).not.toContain('Prefer=')
    const prefer = (init.headers as Record<string, string>)['Prefer']
    expect(prefer).toContain('resolution=merge-duplicates')
    expect(prefer).toContain('return=representation')
  })
})

describe('setScopeItemPartyAction upsert', () => {
  it('POSTs tenant_scope_items with Prefer: resolution=merge-duplicates (no 409 → PATCH-fallback detour)', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await setScopeItemPartyAction(UUID, NODE, SCOPE, 'tenant')
    expect(res).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/rest/v1/tenant_scope_items')
    expect(String(url)).toContain('on_conflict=node_id%2Cscope_item_type_id')
    const prefer = (init.headers as Record<string, string>)['Prefer']
    expect(prefer).toContain('resolution=merge-duplicates')
    expect(prefer).toContain('return=representation')
    // POST succeeded, so the legacy PATCH fallback on tenant_scope_items must not fire
    const scopeItemPatches = fetchMock.mock.calls.filter(
      ([u, i]) => String(u).includes('tenant_scope_items') && (i as RequestInit).method === 'PATCH',
    )
    expect(scopeItemPatches).toHaveLength(0)
  })
})
