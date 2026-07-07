// @vitest-environment node
import { describe, it, expect, vi } from 'vitest'

// The error-bounce branch under test returns before any Supabase call; the
// mocks only keep module evaluation and the fall-through path inert.
vi.mock('@/lib/supabase/server', () => ({
  createClient: vi.fn(async () => ({
    auth: {
      exchangeCodeForSession: vi.fn(async () => ({ data: { user: null }, error: new Error('bad code') })),
      verifyOtp: vi.fn(async () => ({ data: { user: null }, error: new Error('bad token') })),
    },
  })),
  createServiceClient: vi.fn(() => ({})),
}))
vi.mock('next/headers', () => ({ headers: vi.fn(async () => new Headers()) }))
vi.mock('@esite/shared', () => ({ logAuthEvent: vi.fn() }))

import { GET } from './route'

const ORIGIN = 'https://app.example.test'

function get(query: string) {
  return GET(new Request(`${ORIGIN}/auth/callback${query}`))
}

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
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/reset-password')
    expect(location.searchParams.get('step')).toBe('code')
    expect(location.searchParams.get('error')).toBe('otp_expired')
    expect(location.searchParams.get('reason')).toBe('link-expired')
    expect(location.searchParams.get('email')).toBe('user@co.za')
  })

  it('sends non-reset-password bounces to /login without reason', async () => {
    const res = await get('?error_code=otp_expired&next=/dashboard')
    const location = new URL(res.headers.get('location') ?? '')
    expect(location.pathname).toBe('/login')
    expect(location.searchParams.get('error')).toBe('otp_expired')
    expect(location.searchParams.get('reason')).toBeNull()
  })

  it('falls back to /login?error=auth_callback_failed with no token at all', async () => {
    const res = await get('')
    expect(res.headers.get('location')).toBe(`${ORIGIN}/login?error=auth_callback_failed`)
  })
})
