// @vitest-environment node
import { describe, it, expect, vi, beforeEach } from 'vitest'

const mocks = vi.hoisted(() => ({
  verifyOtp: vi.fn(),
  exchangeCodeForSession: vi.fn(),
  logAuthEvent: vi.fn(),
}))

vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: mocks.exchangeCodeForSession,
      verifyOtp: mocks.verifyOtp,
    },
    // redirectWithTheme reads profiles.theme_preference after a successful
    // verify; a null row means "no cookie to set".
    from: vi.fn(() => ({
      select: vi.fn(() => ({
        eq: vi.fn(() => ({
          single: vi.fn(async () => ({ data: null })),
        })),
      })),
    })),
  })),
  createServiceClient: vi.fn(() => ({})),
}))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@esite/shared', () => ({ logAuthEvent: mocks.logAuthEvent }))

import { GET, POST } from './route'

const ORIGIN = 'https://app.example.test'

function get(query: string) {
  return GET(new Request(`${ORIGIN}/auth/callback${query}`))
}

function post(fields: Record<string, string>) {
  return POST(
    new Request(`${ORIGIN}/auth/callback`, {
      method: 'POST',
      body: new URLSearchParams(fields),
    }),
  )
}

function location(res: Response) {
  return new URL(res.headers.get('location') ?? '')
}

beforeEach(() => {
  mocks.verifyOtp.mockReset().mockResolvedValue({
    data: { user: null },
    error: Object.assign(new Error('token expired'), { code: 'otp_expired' }),
  })
  mocks.exchangeCodeForSession.mockReset().mockResolvedValue({
    data: { user: null },
    error: new Error('bad code'),
  })
  mocks.logAuthEvent.mockReset()
})

describe('GET /auth/callback — Supabase error bounces', () => {
  it('sends reset-password bounces to code entry with reason=link-expired', async () => {
    const res = await get('?error_code=otp_expired&next=/reset-password/confirm')
    expect(res.headers.get('location')).toBe(
      `${ORIGIN}/reset-password?step=code&error=otp_expired&reason=link-expired`,
    )
  })

  it('carries the email through to the code-entry page', async () => {
    const res = await get(
      '?error_code=otp_expired&next=/reset-password/confirm&email=user%40co.za',
    )
    const loc = location(res)
    expect(loc.pathname).toBe('/reset-password')
    expect(loc.searchParams.get('step')).toBe('code')
    expect(loc.searchParams.get('error')).toBe('otp_expired')
    expect(loc.searchParams.get('reason')).toBe('link-expired')
    expect(loc.searchParams.get('email')).toBe('user@co.za')
  })

  it('sends non-reset-password bounces to /login without reason', async () => {
    const res = await get('?error_code=otp_expired&next=/dashboard')
    const loc = location(res)
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('error')).toBe('otp_expired')
    expect(loc.searchParams.get('reason')).toBeNull()
  })

  it('falls back to /login?error=auth_callback_failed with no token at all', async () => {
    const res = await get('')
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_failed`)
  })
})

describe('GET /auth/callback — token_hash hands off to the interstitial (scanner hardening)', () => {
  it('redirects to /auth/confirm without calling verifyOtp', async () => {
    const res = await get('?token_hash=htok123&type=recovery&next=/reset-password/confirm')
    const loc = location(res)
    expect(loc.pathname).toBe('/auth/confirm')
    expect(loc.searchParams.get('token_hash')).toBe('htok123')
    expect(loc.searchParams.get('type')).toBe('recovery')
    expect(loc.searchParams.get('next')).toBe('/reset-password/confirm')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('accepts the legacy ?token= alias', async () => {
    const res = await get('?token=htok456&type=magiclink')
    const loc = location(res)
    expect(loc.pathname).toBe('/auth/confirm')
    expect(loc.searchParams.get('token_hash')).toBe('htok456')
    expect(loc.searchParams.get('type')).toBe('magiclink')
    expect(loc.searchParams.get('next')).toBe('/dashboard')
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('carries from and email through to the interstitial', async () => {
    const res = await get(
      '?token_hash=htok123&type=recovery&next=/reset-password/confirm&from=invite&email=user%40co.za',
    )
    const loc = location(res)
    expect(loc.searchParams.get('from')).toBe('invite')
    expect(loc.searchParams.get('email')).toBe('user@co.za')
  })

  it('rejects unknown OTP types without touching the token', async () => {
    const res = await get('?token_hash=htok123&type=not_a_type')
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_failed`)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })
})

describe('GET /auth/callback — PKCE code exchange (unchanged)', () => {
  it('exchanges the code and redirects to next', async () => {
    mocks.exchangeCodeForSession.mockResolvedValueOnce({
      data: { user: { id: 'user-1' } },
      error: null,
    })
    const res = await get('?code=pkce123&next=/dashboard')
    expect(mocks.exchangeCodeForSession).toHaveBeenCalledWith('pkce123')
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`)
  })
})

describe('POST /auth/callback — the interstitial form is the only verifier', () => {
  it('verifies the token and 303-redirects to next', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    const res = await post({
      token_hash: 'htok123',
      type: 'recovery',
      next: '/reset-password/confirm',
    })
    expect(mocks.verifyOtp).toHaveBeenCalledWith({ token_hash: 'htok123', type: 'recovery' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/reset-password/confirm`)
    expect(mocks.logAuthEvent).toHaveBeenCalled()
  })

  it('does not audit email_change verifications as logins', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    await post({ token_hash: 'htok123', type: 'email_change', next: '/dashboard' })
    expect(mocks.logAuthEvent).not.toHaveBeenCalled()
  })

  it('sends an expired reset-password token to code entry with the banner params', async () => {
    const res = await post({
      token_hash: 'burnt',
      type: 'recovery',
      next: '/reset-password/confirm',
      email: 'user@co.za',
    })
    expect(res.status).toBe(303)
    const loc = location(res)
    expect(loc.pathname).toBe('/reset-password')
    expect(loc.searchParams.get('step')).toBe('code')
    expect(loc.searchParams.get('error')).toBe('otp_expired')
    expect(loc.searchParams.get('reason')).toBe('link-expired')
    expect(loc.searchParams.get('email')).toBe('user@co.za')
  })

  it('sends other expired tokens to /login with the error code', async () => {
    const res = await post({ token_hash: 'burnt', type: 'magiclink', next: '/dashboard' })
    expect(res.status).toBe(303)
    const loc = location(res)
    expect(loc.pathname).toBe('/login')
    expect(loc.searchParams.get('error')).toBe('otp_expired')
  })

  it('rejects a missing token_hash without calling verifyOtp', async () => {
    const res = await post({ type: 'recovery', next: '/reset-password/confirm' })
    expect(res.status).toBe(303)
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_failed`)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('rejects unknown OTP types without calling verifyOtp', async () => {
    const res = await post({ token_hash: 'htok123', type: 'not_a_type', next: '/dashboard' })
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_failed`)
    expect(mocks.verifyOtp).not.toHaveBeenCalled()
  })

  it('refuses absolute URLs in next (open-redirect guard)', async () => {
    mocks.verifyOtp.mockResolvedValueOnce({ data: { user: { id: 'user-1' } }, error: null })
    const res = await post({
      token_hash: 'htok123',
      type: 'recovery',
      next: 'https://evil.example/phish',
    })
    expect(res.headers.get('location')).toBe(`${ORIGIN}/dashboard`)
  })
})
