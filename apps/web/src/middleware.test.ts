// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'

/**
 * Middleware gate tests (Onboarding Standard A11).
 *
 * middleware.ts carries four server-side gates — session, email
 * verification, MFA (aal), and org membership — plus the public-path
 * pass-throughs. updateSession (the Supabase cookie/session helper) and the
 * module-level service-role client are mocked; each test drives the gates
 * purely through `state`.
 */

const state = vi.hoisted(() => ({
  user: null as { id: string; email_confirmed_at?: string } | null,
  aal: null as 'aal1' | 'aal2' | null,
  orgCount: 0,
  // Sentinel returned by updateSession — middleware must return it as-is on
  // every pass-through path, so `toBe` identity is the assertion.
  supabaseResponse: { __passthrough: true },
}))

// lib/supabase/middleware exports updateSession only; mock it wholesale.
vi.mock('./lib/supabase/middleware', () => ({
  updateSession: vi.fn(async () => ({
    supabaseResponse: state.supabaseResponse,
    user: state.user,
    aal: state.aal,
    amr: null,
  })),
}))

// middleware.ts builds a module-level service-role client (hasOrg). Mock the
// builder chain: .from().select().eq().eq() awaited -> { count }.
vi.mock('@supabase/supabase-js', () => ({
  createClient: vi.fn(() => ({
    from: () => {
      const builder: Record<string, unknown> = {}
      builder.select = () => builder
      builder.eq = () => builder
      builder.then = (resolve: (value: { count: number }) => void) =>
        resolve({ count: state.orgCount })
      return builder
    },
  })),
}))

import { middleware } from './middleware'

const CONFIRMED = { id: 'user-1', email_confirmed_at: '2026-01-01T00:00:00Z' }

function run(path: string) {
  return middleware(new NextRequest(`http://localhost:3000${path}`))
}

function locationOf(res: Response): URL {
  const location = res.headers.get('location')
  expect(location).toBeTruthy()
  return new URL(location!)
}

beforeEach(() => {
  state.user = null
  state.aal = null
  state.orgCount = 0
})

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('middleware — session gate', () => {
  it('redirects an unauthenticated request on a protected path to /login with ?next', async () => {
    const res = await run('/dashboard')
    const url = locationOf(res)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/dashboard')
  })

  it('carries deep paths through ?next', async () => {
    const res = await run('/projects/abc-123/settings/rates')
    const url = locationOf(res)
    expect(url.pathname).toBe('/login')
    expect(url.searchParams.get('next')).toBe('/projects/abc-123/settings/rates')
  })

  it('passes PUBLIC_PATHS through untouched for anonymous visitors', async () => {
    for (const path of ['/login', '/signup', '/reset-password', '/pricing', '/legal/terms']) {
      const res = await run(path)
      expect(res).toBe(state.supabaseResponse)
    }
  })

  it('bounces an authenticated user off auth pages to /dashboard', async () => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 1
    const res = await run('/login')
    expect(locationOf(res).pathname).toBe('/dashboard')
  })
})

describe('middleware — email-verification gate', () => {
  it('redirects an unconfirmed user to /verify-email', async () => {
    state.user = { id: 'user-1' } // no email_confirmed_at
    state.aal = 'aal2'
    const res = await run('/dashboard')
    expect(locationOf(res).pathname).toBe('/verify-email')
  })
})

describe('middleware — MFA gate', () => {
  it('redirects an aal1 session with a verified factor to /verify-mfa with ?next', async () => {
    state.user = CONFIRMED
    state.aal = 'aal1'
    state.orgCount = 1
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ factors: [{ status: 'verified' }] }),
      })),
    )
    const res = await run('/dashboard')
    const url = locationOf(res)
    expect(url.pathname).toBe('/verify-mfa')
    expect(url.searchParams.get('next')).toBe('/dashboard')
  })

  it('lets an aal1 session with no verified factor through (fail closed on factor lookup)', async () => {
    state.user = CONFIRMED
    state.aal = 'aal1'
    state.orgCount = 1
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, json: async () => ({}) })),
    )
    const res = await run('/dashboard')
    expect(res).toBe(state.supabaseResponse)
  })
})

describe('middleware — org gate', () => {
  it('redirects an authenticated user with no org to /onboarding', async () => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 0
    const res = await run('/dashboard')
    expect(locationOf(res).pathname).toBe('/onboarding')
  })

  it('redirects an authenticated user WITH an org off /onboarding to /dashboard', async () => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 1
    const res = await run('/onboarding')
    expect(locationOf(res).pathname).toBe('/dashboard')
  })

  it('keeps a user with no org ON /onboarding (no redirect loop)', async () => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 0
    const res = await run('/onboarding')
    // Falls through to the session pass-through — no redirect issued.
    expect(res).toBe(state.supabaseResponse)
  })

  it('passes an authenticated user with an org through to protected paths', async () => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 1
    const res = await run('/projects/abc-123')
    expect(res).toBe(state.supabaseResponse)
  })
})

describe('middleware — self-authenticating API bypass', () => {
  it('never redirects Bearer-auth API routes, even without a cookie session', async () => {
    const res = await run('/api/notifications/dispatch')
    expect(res.headers.get('location')).toBeNull()
    // Must NOT be the session pass-through either — updateSession is skipped.
    expect(res).not.toBe(state.supabaseResponse)
  })
})
