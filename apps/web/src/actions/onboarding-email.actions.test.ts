// @vitest-environment node
/**
 * The Day-0 welcome email has never reached a single user. signup/page.tsx is
 * a client component that called `supabase.functions.invoke` with the BROWSER
 * client; onboarding-email-d0's first act is requireServiceRole, which 403s
 * anything whose role claim isn't service_role. functions.invoke RESOLVES with
 * {data, error} instead of rejecting, so the `.catch(() => {})` never ran and
 * the failure was invisible. Production proof: public.email_sequence_events
 * holds d1=33, d3=36, d7=36, d14=36 and ZERO d0 rows, 2026-04-20 → 2026-08-30.
 *
 * The wrapper that fixes it must not become the open relay requireServiceRole
 * was protecting against, so these tests pin the guards as hard as the send:
 * only a userId crosses the wire, the recipient is re-read server-side, a
 * caller cannot mail the existing user base, and a failure is LOUD.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'

const h = vi.hoisted(() => ({
  headerMap: new Map<string, string>(),
  rateLimitOk: true,
  rateLimitCalls: [] as unknown[][],
  getUserById: vi.fn(),
  invoke: vi.fn(),
}))

vi.mock('next/headers', () => ({
  headers: async () => ({ get: (k: string) => h.headerMap.get(k) ?? null }),
}))
vi.mock('@/lib/rate-limit', () => ({
  rateLimit: (...args: unknown[]) => { h.rateLimitCalls.push(args); return h.rateLimitOk },
}))
vi.mock('@/lib/supabase/server', () => ({
  createServiceClient: () => ({
    auth: { admin: { getUserById: h.getUserById } },
    functions: { invoke: h.invoke },
  }),
}))

import {
  sendWelcomeEmailAction,
  D0_FRESH_SIGNUP_WINDOW_MS,
} from './onboarding-email.actions'

const USER_ID = '018f2d31-bbe8-4cc1-bbdd-63af0187081e'

function userRow(over: Record<string, unknown> = {}) {
  return {
    data: {
      user: {
        id: USER_ID,
        email: 'tanya.engelbrecht@orionpm.co.za',
        created_at: new Date().toISOString(),
        user_metadata: { full_name: 'Tanya Engelbrecht' },
        ...over,
      },
    },
    error: null,
  }
}

beforeEach(() => {
  h.headerMap = new Map([['x-forwarded-for', '196.25.1.1']])
  h.rateLimitOk = true
  h.getUserById.mockReset().mockResolvedValue(userRow())
  h.invoke.mockReset().mockResolvedValue({ data: { status: 'sent' }, error: null })
  h.rateLimitCalls = []
})

describe('sendWelcomeEmailAction — it actually sends', () => {
  it('invokes onboarding-email-d0 through the SERVICE client', async () => {
    const res = await sendWelcomeEmailAction(USER_ID)
    expect(h.invoke).toHaveBeenCalledTimes(1)
    expect(h.invoke.mock.calls[0][0]).toBe('onboarding-email-d0')
    expect(res.outcome).toBe('sent')
  })

  it('reports the edge function verdict instead of swallowing it', async () => {
    h.invoke.mockResolvedValue({ data: { status: 'skipped_duplicate' }, error: null })
    expect((await sendWelcomeEmailAction(USER_ID)).outcome).toBe('skipped_duplicate')
  })

  it('surfaces AND logs a 403 rather than resolving quietly', async () => {
    const err = new Error('Edge Function returned a non-2xx status code')
    h.invoke.mockResolvedValue({ data: null, error: err })
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {})
    const res = await sendWelcomeEmailAction(USER_ID)
    expect(res.outcome).toBe('failed')
    expect(spy).toHaveBeenCalled()
    spy.mockRestore()
  })
})

describe('sendWelcomeEmailAction — it is not a relay', () => {
  it('takes only a userId and re-reads the recipient server-side', async () => {
    // Signature check: one argument. A caller cannot name the recipient.
    expect(sendWelcomeEmailAction.length).toBe(1)
    await sendWelcomeEmailAction(USER_ID)
    expect(h.getUserById).toHaveBeenCalledWith(USER_ID)
    const body = h.invoke.mock.calls[0][1].body
    expect(body.email).toBe('tanya.engelbrecht@orionpm.co.za')
    expect(body.firstName).toBe('Tanya')
    expect(Object.keys(body).sort()).toEqual(['email', 'firstName', 'userId'])
  })

  it('refuses a userId that is not a uuid without touching the admin API', async () => {
    const res = await sendWelcomeEmailAction('../../etc/passwd')
    expect(res.outcome).toBe('unknown_user')
    expect(h.getUserById).not.toHaveBeenCalled()
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('refuses an unknown user', async () => {
    h.getUserById.mockResolvedValue({ data: { user: null }, error: { message: 'not found' } })
    expect((await sendWelcomeEmailAction(USER_ID)).outcome).toBe('unknown_user')
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('will not mail an account that did not just sign up', async () => {
    // Without this, anyone who can call the action can walk every user id in
    // the system and mail all 36 accounts a "thanks for signing up" welcome.
    const stale = new Date(Date.now() - D0_FRESH_SIGNUP_WINDOW_MS - 1000).toISOString()
    h.getUserById.mockResolvedValue(userRow({ created_at: stale }))
    expect((await sendWelcomeEmailAction(USER_ID)).outcome).toBe('not_a_fresh_signup')
    expect(h.invoke).not.toHaveBeenCalled()
  })

  it('still mails an account created moments ago', async () => {
    const fresh = new Date(Date.now() - 5_000).toISOString()
    h.getUserById.mockResolvedValue(userRow({ created_at: fresh }))
    expect((await sendWelcomeEmailAction(USER_ID)).outcome).toBe('sent')
  })

  it('rate-limits per IP', async () => {
    h.rateLimitOk = false
    expect((await sendWelcomeEmailAction(USER_ID)).outcome).toBe('rate_limited')
    expect(h.invoke).not.toHaveBeenCalled()
    expect(h.rateLimitCalls[0][0]).toContain('196.25.1.1')
  })
})
