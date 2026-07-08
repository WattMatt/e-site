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
  upsertCircuitAction,
  deleteCircuitAction,
  quickAddWaysAction,
  updateLegendHeaderAction,
} from './db-legend.actions'

const PROJECT = '11111111-1111-1111-1111-111111111111'
const NODE = '22222222-2222-2222-2222-222222222222'
const CIRCUIT = '33333333-3333-3333-3333-333333333333'

/**
 * Supabase cookie-client mock. Covers:
 *  - auth.getUser
 *  - requireEffectiveRole's RPC
 *  - guardNodeBelongsToProject: .schema().from('nodes').select().eq().eq().maybeSingle()
 *  - quickAdd's existing-circuits read: .schema().from('node_circuits').select().eq() (thenable)
 */
function mockClient(opts: { role?: string | null; existingCircuits?: Array<{ circuit_no: string; sort_order: number }> } = {}) {
  const { role = 'owner', existingCircuits = [] } = opts
  const nodesQuery: any = {
    select: () => nodesQuery,
    eq: () => nodesQuery,
    maybeSingle: () => Promise.resolve({ data: { id: NODE } }),
  }
  const circuitsQuery: any = {
    select: () => circuitsQuery,
    eq: () => circuitsQuery,
    then: (resolve: (v: unknown) => void) => resolve({ data: existingCircuits, error: null }),
  }
  return {
    auth: { getUser: () => Promise.resolve({ data: { user: { id: 'u-1' } } }) },
    rpc: () => Promise.resolve({ data: role, error: null }),
    schema: () => ({
      from: (table: string) => (table === 'node_circuits' ? circuitsQuery : nodesQuery),
    }),
  }
}

function okFetch(body: unknown = [{ id: CIRCUIT }]) {
  return vi.fn().mockResolvedValue({ ok: true, status: 201, json: () => Promise.resolve(body), text: () => Promise.resolve('') })
}

beforeEach(() => {
  createClientMock.mockReset(); revalidatePathMock.mockReset(); getByIdMock.mockReset()
  getByIdMock.mockResolvedValue({ organisation_id: 'org-1' })
  createClientMock.mockResolvedValue(mockClient())
  vi.unstubAllGlobals()
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
})

describe('role gate (service-role writes require ORG_WRITE_ROLES)', () => {
  it.each([
    ['upsertCircuitAction', () => upsertCircuitAction(PROJECT, NODE, { circuit_no: '1', is_spare: false })],
    ['deleteCircuitAction', () => deleteCircuitAction(PROJECT, NODE, CIRCUIT)],
    ['quickAddWaysAction', () => quickAddWaysAction(PROJECT, NODE, 3)],
    ['updateLegendHeaderAction', () => updateLegendHeaderAction(PROJECT, NODE, { db_location: 'Back room' })],
  ])('%s denies when the effective-role RPC returns null', async (_name, call) => {
    createClientMock.mockResolvedValue(mockClient({ role: null }))
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
    const res = await call()
    expect('error' in res).toBe(true)
    expect(fetchMock).not.toHaveBeenCalled()
  })
})

describe('upsertCircuitAction', () => {
  it('POSTs a new circuit and returns the inserted row', async () => {
    const fetchMock = okFetch([{ id: CIRCUIT, node_id: NODE, circuit_no: '4', sort_order: 1 }])
    vi.stubGlobal('fetch', fetchMock)
    const res = await upsertCircuitAction(PROJECT, NODE, {
      circuit_no: '4', description: 'Lights shop 5', phase: 'L1',
      breaker_rating_a: 20, poles: 1, curve: 'C', cable_size: '2.5mm²', is_spare: false,
    })
    expect(res).toMatchObject({ ok: true })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toContain('/rest/v1/node_circuits')
    expect(init.method).toBe('POST')
    expect((init.headers as Record<string, string>)['Content-Profile']).toBe('structure')
  })

  it('maps a 409 duplicate to a friendly error', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
      ok: false, status: 409, text: () => Promise.resolve('duplicate key value violates unique constraint'),
    }))
    const res = await upsertCircuitAction(PROJECT, NODE, { circuit_no: '4', is_spare: false })
    expect('error' in res && /already exists/i.test((res as { error: string }).error)).toBe(true)
  })

  it('PATCHes when an id is supplied', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await upsertCircuitAction(PROJECT, NODE, { id: CIRCUIT, circuit_no: '4', is_spare: true })
    expect(res).toMatchObject({ ok: true })
    expect(fetchMock.mock.calls[0][1].method).toBe('PATCH')
    expect(String(fetchMock.mock.calls[0][0])).toContain(`id=eq.${CIRCUIT}`)
  })
})

describe('quickAddWaysAction', () => {
  it('numbers new ways after the highest existing integer and POSTs them as spares', async () => {
    createClientMock.mockResolvedValue(mockClient({
      existingCircuits: [{ circuit_no: '2', sort_order: 1 }, { circuit_no: 'A1', sort_order: 2 }],
    }))
    const fetchMock = okFetch([{ id: 'x1' }, { id: 'x2' }])
    vi.stubGlobal('fetch', fetchMock)
    const res = await quickAddWaysAction(PROJECT, NODE, 2)
    expect(res).toMatchObject({ ok: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body.map((r: { circuit_no: string }) => r.circuit_no)).toEqual(['3', '4'])
    expect(body.every((r: { is_spare: boolean }) => r.is_spare === true)).toBe(true)
    expect(body.map((r: { sort_order: number }) => r.sort_order)).toEqual([3, 4])
  })
})

describe('updateLegendHeaderAction', () => {
  it('upserts tenant_details with only allowlisted keys', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await updateLegendHeaderAction(PROJECT, NODE, {
      db_location: 'Back of shop', legend_card_size: 'A5',
      // @ts-expect-error — unknown keys must be rejected by zod, not forwarded
      scope_status: 'received',
    })
    expect(res).toMatchObject({ ok: true })
    const body = JSON.parse(fetchMock.mock.calls[0][1].body as string)
    expect(body).toEqual({ node_id: NODE, db_location: 'Back of shop', legend_card_size: 'A5' })
    expect(String(fetchMock.mock.calls[0][0])).toContain('on_conflict=node_id')
  })
})

describe('deleteCircuitAction', () => {
  it('DELETEs scoped by id AND node_id', async () => {
    const fetchMock = okFetch()
    vi.stubGlobal('fetch', fetchMock)
    const res = await deleteCircuitAction(PROJECT, NODE, CIRCUIT)
    expect(res).toMatchObject({ ok: true })
    const url = String(fetchMock.mock.calls[0][0])
    expect(url).toContain(`id=eq.${CIRCUIT}`)
    expect(url).toContain(`node_id=eq.${NODE}`)
  })
})
