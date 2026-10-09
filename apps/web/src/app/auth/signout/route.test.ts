// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

const signOut = vi.fn(async () => ({ error: null }))
vi.mock('next/headers', () => ({ headers: async () => new Map() }))
vi.mock('@esite/shared', () => ({ logAuthEvent: vi.fn(async () => undefined) }))
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ auth: { getUser: async () => ({ data: { user: { id: 'u1' } } }), signOut } }),
  createServiceClient: () => ({}),
}))

import { POST } from './route'

function post(body?: Record<string, string>) {
  const init: RequestInit = { method: 'POST' }
  if (body) init.body = new URLSearchParams(body)
  return POST(new Request('https://e-site.live/auth/signout', init))
}

describe('POST /auth/signout', () => {
  it('signs out and returns a WM user to /login (relative: the same origin the browser posted to)', async () => {
    const r = await post()
    expect(signOut).toHaveBeenCalled()
    expect(r.status).toBe(303)
    expect(r.headers.get('location')).toBe('/login')
  })

  it('returns a tenderer to /tender/login', async () => {
    const r = await post({ to: '/tender/login' })
    expect(r.headers.get('location')).toBe('/tender/login')
  })

  it('accepts no other destination', async () => {
    for (const to of ['https://evil.example/', '//evil.example', '/dashboard']) {
      expect((await post({ to })).headers.get('location')).toBe('/login')
    }
  })
})
