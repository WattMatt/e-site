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

import { updateTenantEntryAction } from './tenant-entry.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'

/** Chainable structure-schema query stub: every filter method returns itself;
 *  maybeSingle resolves the next queued result. */
function structureChain(queue: Array<{ data: unknown }>) {
  const chain: any = {}
  for (const m of ['select', 'eq', 'neq', 'is']) chain[m] = () => chain
  chain.maybeSingle = () => Promise.resolve(queue.shift() ?? { data: null })
  return chain
}

/**
 * Supabase mock for updateTenantEntryAction:
 *  - auth.getUser → a user
 *  - from('user_organisations') … maybeSingle → membership role
 *  - schema('structure').from('nodes') … maybeSingle → queued results:
 *      1) the node-belongs-to-project check
 *      2) the shop-number uniqueness check (null = no clash)
 */
function mockClient(opts: { role?: string | null; structureResults?: Array<{ data: unknown }> } = {}) {
  const { role = 'owner', structureResults = [{ data: { id: NODE, shop_number: '23' } }, { data: null }] } = opts
  const queue = [...structureResults]
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    from: () => ({
      select: () => ({
        eq: () => ({
          eq: () => ({ maybeSingle: () => Promise.resolve({ data: role ? { role } : null }) }),
        }),
      }),
    }),
    schema: () => ({ from: () => structureChain(queue) }),
  }
}

beforeEach(() => {
  createClientMock.mockReset()
  revalidatePathMock.mockReset()
  getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('updateTenantEntryAction — validation (before any I/O)', () => {
  it('rejects a non-uuid projectId', async () => {
    const res = await updateTenantEntryAction('nope', NODE, { shopNumber: '23', shopName: 'PEP HOME', shopAreaM2: 100 })
    expect(res).toEqual({ error: expect.any(String) })
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a blank SHOP NO.', async () => {
    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '   ', shopName: null, shopAreaM2: null })
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })

  it('rejects a non-finite area', async () => {
    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '23', shopName: null, shopAreaM2: NaN })
    expect('error' in res).toBe(true)
    expect(createClientMock).not.toHaveBeenCalled()
  })
})

describe('updateTenantEntryAction — authorization', () => {
  it('denies roles outside owner/admin/project_manager', async () => {
    createClientMock.mockResolvedValue(mockClient({ role: 'client_viewer' }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '23', shopName: 'PEP', shopAreaM2: 100 })
    expect(res).toEqual({ error: expect.stringContaining('permission') })
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('errors when the node is not a live tenant of this project', async () => {
    createClientMock.mockResolvedValue(mockClient({ structureResults: [{ data: null }] }))
    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '23', shopName: 'PEP', shopAreaM2: 100 })
    expect(res).toEqual({ error: expect.stringContaining('not found') })
  })
})

describe('updateTenantEntryAction — shop-number uniqueness', () => {
  it('rejects a SHOP NO. already used by another tenant in the project', async () => {
    createClientMock.mockResolvedValue(
      mockClient({
        structureResults: [
          { data: { id: NODE, shop_number: '23' } }, // node check
          { data: { id: 'other-node' } },            // uniqueness clash
        ],
      }),
    )
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: 'R1', shopName: 'LUPA', shopAreaM2: 295 })
    expect(res).toEqual({ error: expect.stringContaining('already used') })
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('updateTenantEntryAction — happy path', () => {
  it('PATCHes the node with trimmed fields and revalidates the schedule', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateTenantEntryAction(PROJECT, NODE, {
      shopNumber: ' R1 ',
      shopName: '  LUPA ',
      shopAreaM2: 295,
    })
    expect(res).toEqual({ ok: true })

    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit]
    expect(url).toContain(`/rest/v1/nodes?id=eq.${NODE}`)
    expect(init.method).toBe('PATCH')
    expect((init.headers as Record<string, string>)['Content-Profile']).toBe('structure')
    expect(JSON.parse(init.body as string)).toEqual({
      shop_number: 'R1',
      shop_name: 'LUPA',
      shop_area_m2: 295,
    })

    expect(revalidatePathMock).toHaveBeenCalledWith(`/projects/${PROJECT}/tenant-schedule`)
  })

  it('clears name and area with nulls (pending area)', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, text: () => Promise.resolve('') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '23', shopName: null, shopAreaM2: null })
    expect(res).toEqual({ ok: true })
    expect(JSON.parse((fetchMock.mock.calls[0][1] as RequestInit).body as string)).toEqual({
      shop_number: '23',
      shop_name: null,
      shop_area_m2: null,
    })
  })

  it('surfaces a PATCH failure as a readable error', async () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: false, status: 500, text: () => Promise.resolve('boom') })
    vi.stubGlobal('fetch', fetchMock)

    const res = await updateTenantEntryAction(PROJECT, NODE, { shopNumber: '23', shopName: 'PEP', shopAreaM2: 100 })
    expect(res).toEqual({ error: expect.stringContaining('HTTP 500') })
    expect(revalidatePathMock).not.toHaveBeenCalled()
  })
})
