// apps/web/src/app/wa/[itemId]/route.test.ts
import { describe, it, expect, vi } from 'vitest'
const { createClientMock } = vi.hoisted(() => ({ createClientMock: vi.fn() }))
vi.mock('@/lib/supabase/server', () => ({ createClient: createClientMock }))
import { GET } from './route'

const ITEM = '11111111-1111-4111-8111-111111111111'
const client = (user: unknown, row: unknown) => ({
  auth: { getUser: async () => ({ data: { user } }) },
  schema: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }) }),
})
const req = () => new Request(`https://www.e-site.live/wa/${ITEM}`)

describe('GET /wa/[itemId]', () => {
  it('signed out -> login with next', async () => {
    createClientMock.mockResolvedValue(client(null, null))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe(`https://www.e-site.live/login?next=%2Fwa%2F${ITEM}`)
  })
  it('visible item -> its page', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, { project_id: 'P', ref: 'T-4' }))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/projects/P/items/T-4')
  })
  it('invisible item (RLS returned nothing) -> dashboard, no leak of existence', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, null))
    const r = await GET(req(), { params: Promise.resolve({ itemId: ITEM }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/dashboard')
  })
  it('junk id -> dashboard without a query', async () => {
    createClientMock.mockResolvedValue(client({ id: 'u' }, null))
    const r = await GET(new Request('https://www.e-site.live/wa/x'), { params: Promise.resolve({ itemId: 'x' }) })
    expect(r.headers.get('location')).toBe('https://www.e-site.live/dashboard')
  })
})
