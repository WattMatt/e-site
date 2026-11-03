import { vi, describe, it, expect, beforeEach } from 'vitest'
const { cookies, createSupabaseClient, createServerClient } = vi.hoisted(() => ({
  cookies: vi.fn(),
  createSupabaseClient: vi.fn(() => ({ tag: 'bearer-client' })),
  createServerClient: vi.fn(() => ({ tag: 'cookie-client' })),
}))
vi.mock('next/headers', () => ({ cookies }))
vi.mock('@supabase/supabase-js', () => ({ createClient: createSupabaseClient }))
vi.mock('@supabase/ssr', () => ({ createServerClient }))
import { createClient } from './server'
import { runWithBearer, getBearerContext } from './request-auth'

describe('createClient under a bearer context', () => {
  beforeEach(() => { vi.stubEnv('NEXT_PUBLIC_SUPABASE_URL', 'http://localhost:54321'); vi.stubEnv('NEXT_PUBLIC_SUPABASE_ANON_KEY', 'anon'); cookies.mockReset(); createSupabaseClient.mockClear(); createServerClient.mockClear() })
  it('binds the bearer and never touches cookies', async () => {
    const ctx = { accessToken: 'tok', user: { id: 'u1' } as never, claims: { sub: 'u1', aal: 'aal1' } as never }
    const client = await runWithBearer(ctx, () => createClient())
    expect(client).toEqual({ tag: 'bearer-client' })
    expect(cookies).not.toHaveBeenCalled()
    expect(createSupabaseClient).toHaveBeenCalledWith(expect.any(String), expect.any(String), expect.objectContaining({
      global: { headers: { Authorization: 'Bearer tok' } },
      auth: { persistSession: false, autoRefreshToken: false },
    }))
  })
  it('outside the context behaves as before', async () => {
    cookies.mockResolvedValue({ getAll: () => [], set: () => {} })
    const client = await createClient()
    expect(client).toEqual({ tag: 'cookie-client' })
    expect(cookies).toHaveBeenCalledTimes(1)
    expect(getBearerContext()).toBeNull()
  })
  it('does not leak across concurrent requests', async () => {
    const a = runWithBearer({ accessToken: 'A', user: { id: 'a' } as never, claims: {} as never }, async () => { await new Promise(r => setTimeout(r, 5)); return getBearerContext()?.accessToken })
    const b = runWithBearer({ accessToken: 'B', user: { id: 'b' } as never, claims: {} as never }, async () => getBearerContext()?.accessToken)
    expect(await Promise.all([a, b])).toEqual(['A', 'B'])
  })
})
