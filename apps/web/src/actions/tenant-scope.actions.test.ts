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
  removeScopeItemTypeAction,
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
function mockClient(opts: { role?: string | null; orgRole?: string | null } = {}) {
  const { role = 'owner', orgRole = 'owner' } = opts
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
    // requireRole: public.user_organisations (active membership of the org)
    from: (_table: string) => ({
      select: () => {
        const chain: Record<string, unknown> = {}
        chain.eq = () => chain
        chain.maybeSingle = () =>
          Promise.resolve({ data: orgRole ? { role: orgRole } : null, error: null })
        return chain
      },
    }),
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

// ---------------------------------------------------------------------------
// Scope item registry (org-wide). Incident 2026-10-16: "+ Add scope item" with
// label "Shop 6" added a column to every tenant on every project, and the old
// merge-duplicates upsert let a re-used key silently rename an existing type.
// ---------------------------------------------------------------------------

const TYPE_DB = { id: 'aaaaaaaa-0000-0000-0000-000000000001', key: 'db', label: 'DB', sort_order: 0 }
const TYPE_LIGHT = { id: 'aaaaaaaa-0000-0000-0000-000000000002', key: 'lighting', label: 'Lighting', sort_order: 1 }
const TYPE_SF = { id: 'aaaaaaaa-0000-0000-0000-000000000003', key: 'shopfront', label: 'Shopfront', sort_order: 5 }

type Call = { method: string; url: string; init: RequestInit }

/** Routes the service-key PostgREST calls the registry actions make. */
function registryFetch(opts: {
  types?: Array<typeof TYPE_DB>
  scopeItemCount?: number | null
  orderCount?: number | null
  insertStatus?: number
  deleted?: unknown[]
} = {}) {
  const { types = [TYPE_DB, TYPE_LIGHT, TYPE_SF], scopeItemCount = 0, orderCount = 0, insertStatus = 201 } = opts
  const calls: Call[] = []
  const fn = vi.fn(async (url: string, init: RequestInit = {}) => {
    const method = (init.method ?? 'GET').toUpperCase()
    calls.push({ method, url: String(url), init })
    const u = new URL(String(url))
    const table = u.pathname.split('/').pop()
    const json = (body: unknown, status = 200, headers: Record<string, string> = {}) => ({
      ok: status < 300,
      status,
      json: () => Promise.resolve(body),
      text: () => Promise.resolve(typeof body === 'string' ? body : JSON.stringify(body)),
      headers: { get: (h: string) => headers[h.toLowerCase()] ?? null },
    })
    if (table === 'scope_item_types' && method === 'GET') {
      const id = u.searchParams.get('id')
      return json(id ? types.filter((t) => `eq.${t.id}` === id) : types)
    }
    if (table === 'scope_item_types' && method === 'POST') {
      if (insertStatus >= 300) return json('duplicate key value violates unique constraint', insertStatus)
      return json([{ id: SCOPE }], 201)
    }
    if (table === 'scope_item_types' && method === 'DELETE') {
      const id = u.searchParams.get('id')
      return json(opts.deleted ?? types.filter((t) => `eq.${t.id}` === id))
    }
    if (table === 'tenant_scope_items' || table === 'node_orders') {
      const n = table === 'tenant_scope_items' ? scopeItemCount : orderCount
      return json('', 200, n === null ? {} : { 'content-range': `*/${n}` })
    }
    return json('unexpected', 500)
  })
  return { fn, calls }
}

const writes = (calls: Call[]) => calls.filter((c) => c.method !== 'GET' && c.method !== 'HEAD')

describe('addScopeItemTypeAction', () => {
  it('inserts a new type with a plain INSERT — never merge-duplicates, never on_conflict', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'power_points', 'Power Points')
    expect(res).toEqual({ ok: true, id: SCOPE })
    const posts = calls.filter((c) => c.method === 'POST')
    expect(posts).toHaveLength(1)
    expect(posts[0].url).not.toContain('on_conflict')
    const prefer = (posts[0].init.headers as Record<string, string>)['Prefer']
    expect(prefer).not.toContain('merge-duplicates')
    expect(JSON.parse(posts[0].init.body as string)).toEqual({
      organisation_id: ORG, key: 'power_points', label: 'Power Points', sort_order: 6,
    })
  })

  it('refuses a key that already exists and writes nothing (no org-wide rename)', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'db', 'Distribution board')
    expect(res).toEqual({ error: '"Distribution board" already exists as a scope item.' })
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses a label that already exists (case-insensitive, trimmed) and writes nothing', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'lighting_2', '  lIGHTING ')
    expect(res).toEqual({ error: '"lIGHTING" already exists as a scope item.' })
    expect(writes(calls)).toHaveLength(0)
  })

  it('turns a unique-key 409 (a concurrent add) into the same sentence', async () => {
    const { fn } = registryFetch({ insertStatus: 409 })
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'power_points', 'Power Points')
    expect(res).toEqual({ error: '"Power Points" already exists as a scope item.' })
  })

  it('refuses a project-promoted PM who holds no org write role, and writes nothing', async () => {
    // Effective project role passes (per-project promotion) but the org role does not.
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', orgRole: null }))
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'power_points', 'Power Points')
    expect('error' in res).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('refuses an org contractor even with project access', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'owner', orgRole: 'contractor' }))
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'power_points', 'Power Points')
    expect('error' in res).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('still requires project access (effective role) as well as the org role', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: null, orgRole: 'owner' }))
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await addScopeItemTypeAction(UUID, ORG, 'power_points', 'Power Points')
    expect('error' in res).toBe(true)
    expect(calls).toHaveLength(0)
  })
})

describe('removeScopeItemTypeAction', () => {
  it('deletes an unused, non-built-in type (scoped to the org)', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect(res).toEqual({ ok: true })
    const dels = calls.filter((c) => c.method === 'DELETE')
    expect(dels).toHaveLength(1)
    expect(dels[0].url).toContain(`id=eq.${TYPE_SF.id}`)
    expect(dels[0].url).toContain(`organisation_id=eq.${ORG}`)
    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${UUID}/tenant-schedule`)
  })

  it.each([TYPE_DB, TYPE_LIGHT])('refuses the built-in "$key" type and writes nothing', async (t) => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, t.id)
    expect(res).toEqual({ error: `"${t.label}" is a built-in scope item and cannot be removed.` })
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses an in-use type with counts in the sentence and writes nothing', async () => {
    const { fn, calls } = registryFetch({ scopeItemCount: 3, orderCount: 2 })
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect(res).toEqual({ error: 'Used by 3 tenants and 2 order lines — clear those first.' })
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses when only order lines reference it (singular wording)', async () => {
    const { fn, calls } = registryFetch({ scopeItemCount: 0, orderCount: 1 })
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect(res).toEqual({ error: 'Used by 0 tenants and 1 order line — clear those first.' })
    expect(writes(calls)).toHaveLength(0)
  })

  it('counts references with the service key across the whole org (not the caller\'s RLS view)', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    const counts = calls.filter((c) => /tenant_scope_items|node_orders/.test(c.url))
    expect(counts).toHaveLength(2)
    for (const c of counts) {
      expect(c.url).toContain(`scope_item_type_id=eq.${TYPE_SF.id}`)
      const h = c.init.headers as Record<string, string>
      expect(h['Authorization']).toBe('Bearer svc')
      expect(h['Prefer']).toContain('count=exact')
    }
  })

  it('fails closed when a reference count cannot be read', async () => {
    const { fn, calls } = registryFetch({ scopeItemCount: null })
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect('error' in res).toBe(true)
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses a type that is not in this org', async () => {
    const { fn, calls } = registryFetch({ types: [TYPE_DB] })
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect(res).toEqual({ error: 'Scope item not found.' })
    expect(writes(calls)).toHaveLength(0)
  })

  it('refuses a project-promoted PM who holds no org write role, and writes nothing', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'project_manager', orgRole: null }))
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect('error' in res).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('refuses an org mismatch', async () => {
    const { fn, calls } = registryFetch()
    vi.stubGlobal('fetch', fn)
    const res = await removeScopeItemTypeAction(UUID, '55555555-5555-5555-5555-555555555555', TYPE_SF.id)
    expect('error' in res).toBe(true)
    expect(calls).toHaveLength(0)
  })

  it('never throws — a network failure returns an error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new Error('boom')))
    const res = await removeScopeItemTypeAction(UUID, ORG, TYPE_SF.id)
    expect('error' in res).toBe(true)
  })
})
