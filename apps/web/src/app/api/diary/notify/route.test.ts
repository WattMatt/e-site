// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

// Env must be set before route.ts evaluates its module-level consts. The import
// is hoisted above plain statements, so set it inside vi.hoisted (runs first).
const { getUserMock, notifyMock, rateLimitMock, entryResult, memResult } = vi.hoisted(() => {
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://x.supabase.co'
  process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY = 'anon-key'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'service-key'
  return {
    getUserMock: vi.fn(),
    notifyMock: vi.fn(),
    rateLimitMock: vi.fn(),
    entryResult: { value: { data: null as any, error: null as any } },
    memResult: { value: { data: null as any, error: null as any } },
  }
})

// Anon client (key === 'anon-key') verifies the JWT; service client serves the
// entry read (.schema('projects')) and the membership read (.from(...)).
vi.mock('@supabase/supabase-js', () => ({
  createClient: (_url: string, key: string) => {
    if (key === 'anon-key') return { auth: { getUser: getUserMock } }
    const chain = (res: any): any => ({
      select: () => chain(res),
      eq: () => chain(res),
      maybeSingle: () => Promise.resolve(res),
    })
    return {
      schema: () => ({ from: () => chain(entryResult.value) }),
      from: () => chain(memResult.value),
    }
  },
}))
vi.mock('@/lib/rate-limit', () => ({ rateLimit: (...a: unknown[]) => rateLimitMock(...a) }))
vi.mock('@/lib/diary-email', () => ({ notifyDiaryEntryCreated: (...a: unknown[]) => notifyMock(...a) }))

import { POST } from './route'

const ENTRY_ID = '11111111-1111-1111-1111-111111111111'

function reqWith(opts: { auth?: string | null; body?: unknown } = {}) {
  const { auth = 'Bearer token', body = { entryId: ENTRY_ID } } = opts
  return {
    headers: { get: (k: string) => (k.toLowerCase() === 'authorization' ? auth : null) },
    json: async () => body,
  } as any
}

beforeEach(() => {
  getUserMock.mockReset(); notifyMock.mockReset(); rateLimitMock.mockReset()
  rateLimitMock.mockReturnValue(true)
  getUserMock.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
  entryResult.value = { data: { id: ENTRY_ID, project_id: 'p1', organisation_id: 'o1', created_by: 'u1' }, error: null }
  memResult.value = { data: { user_id: 'u1' }, error: null }
})

describe('POST /api/diary/notify', () => {
  it('401 without a bearer token', async () => {
    const res = await POST(reqWith({ auth: null }))
    expect(res.status).toBe(401)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('401 when the JWT is invalid', async () => {
    getUserMock.mockResolvedValue({ data: { user: null }, error: { message: 'bad' } })
    expect((await POST(reqWith())).status).toBe(401)
  })

  it('429 when rate-limited', async () => {
    rateLimitMock.mockReturnValue(false)
    const res = await POST(reqWith())
    expect(res.status).toBe(429)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('400 on an invalid body (non-uuid entryId)', async () => {
    const res = await POST(reqWith({ body: { entryId: 'nope' } }))
    expect(res.status).toBe(400)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('404 when the entry does not exist', async () => {
    entryResult.value = { data: null, error: null }
    const res = await POST(reqWith())
    expect(res.status).toBe(404)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('403 when the caller is not a member of the entry org', async () => {
    memResult.value = { data: null, error: null }
    const res = await POST(reqWith())
    expect(res.status).toBe(403)
    expect(notifyMock).not.toHaveBeenCalled()
  })

  it('notifies with the entry org + author when authorised', async () => {
    const res = await POST(reqWith())
    expect(res.status).toBe(200)
    expect(notifyMock).toHaveBeenCalledWith({ entryId: ENTRY_ID, projectId: 'p1', authorId: 'u1' })
  })
})
