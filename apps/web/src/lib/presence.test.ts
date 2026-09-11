import { describe, it, expect, vi, beforeEach } from 'vitest'

// `server-only` throws outside the react-server condition (see
// analytics/product-events.test.ts). Under vitest it resolves to
// src/test/server-only-stub.ts, so this mock is belt-and-braces rather than
// required; it stays above the import so the intent survives a config change.
vi.mock('server-only', () => ({}))

const h = vi.hoisted(() => ({
  userAgent: null as string | null,
  headersThrow: false,
  rpc: vi.fn(),
}))

// Same shape as actions/onboarding-email.actions.test.ts: `headers()` resolves
// to an object whose `get` reads test state lazily, so the hoisted factory never
// touches an uninitialised binding.
vi.mock('next/headers', () => ({
  headers: async () => {
    if (h.headersThrow) throw new Error('headers() called outside a request scope')
    return { get: (k: string) => (k.toLowerCase() === 'user-agent' ? h.userAgent : null) }
  },
}))

// touch_presence keys on auth.uid(), so presence.ts must use the CALLER's
// client. Only createClient is provided here: an import of createServiceClient
// would be undefined, throw inside the try, and fail the first assertion.
vi.mock('@/lib/supabase/server', () => ({
  createClient: async () => ({ rpc: h.rpc }),
}))

import { touchPresence } from './presence'

beforeEach(() => {
  h.userAgent = null
  h.headersThrow = false
  h.rpc.mockReset()
  h.rpc.mockResolvedValue({ data: null, error: null })
})

describe('touchPresence', () => {
  it("calls touch_presence with p_platform 'web' and the request's real user agent", async () => {
    h.userAgent = 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605.1.15'
    await touchPresence('web')
    expect(h.rpc).toHaveBeenCalledTimes(1)
    expect(h.rpc).toHaveBeenCalledWith('touch_presence', {
      p_platform: 'web',
      p_user_agent: 'Mozilla/5.0 (iPad; CPU OS 17_0 like Mac OS X) Safari/605.1.15',
    })
  })

  // A dropped key would be a lost argument (JSON.stringify drops undefined);
  // the SQL default handles null, so null is what must travel.
  it('sends p_user_agent: null when the request carries no user-agent header', async () => {
    h.userAgent = null
    await touchPresence('web')
    const body = h.rpc.mock.calls[0][1] as Record<string, unknown>
    expect('p_user_agent' in body).toBe(true)
    expect(body.p_user_agent).toBeNull()
  })

  it('defaults the platform to web', async () => {
    await touchPresence()
    expect(h.rpc.mock.calls[0][1]).toMatchObject({ p_platform: 'web' })
  })

  // Presence must never be able to fail a page render.
  it('logs an RPC error instead of throwing', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rpc.mockResolvedValue({ data: null, error: { message: 'permission denied for function touch_presence' } })
    await expect(touchPresence('web')).resolves.toBeUndefined()
    expect(err).toHaveBeenCalledWith(expect.stringContaining('touch_presence failed'), expect.anything())
    err.mockRestore()
  })

  it('logs instead of throwing when headers() itself throws', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.headersThrow = true
    await expect(touchPresence('web')).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    expect(h.rpc).not.toHaveBeenCalled()
    err.mockRestore()
  })

  it('logs instead of throwing when the client rejects', async () => {
    const err = vi.spyOn(console, 'error').mockImplementation(() => {})
    h.rpc.mockRejectedValue(new Error('network'))
    await expect(touchPresence('web')).resolves.toBeUndefined()
    expect(err).toHaveBeenCalled()
    err.mockRestore()
  })
})
