import { describe, it, expect, vi, beforeEach } from 'vitest'
import { NextRequest } from 'next/server'

// ─── Mocks ───────────────────────────────────────────────────────────────────
// The middleware builds a service-role client at module load (createClient) and
// calls updateSession() per request. We control both: updateSession returns the
// session shape, and the service client answers the org / grant existence checks.

const updateSessionMock = vi.fn()
vi.mock('./lib/supabase/middleware', () => ({
  updateSession: (...a: any[]) => updateSessionMock(...a),
}))

// Per-table count results the service client should return.
let orgCount = 0
let grantCount = 0

function makeServiceClient() {
  return {
    from(table: string) {
      const count = table === 'user_organisations' ? orgCount
        : table === 'client_site_grants' ? grantCount
        : 0
      // chainable .select().eq().eq() — every link returns the same resolvable
      // thenable so any number of .eq() calls works and awaiting yields { count }.
      const chain: any = {
        select: () => chain,
        eq: () => chain,
        then: (resolve: any) => resolve({ count, error: null }),
      }
      return chain
    },
  }
}

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => makeServiceClient(),
}))

// hasVerifiedMfaFactor calls fetch — stub it to "no factor" so the MFA gate is inert.
const fetchMock = vi.fn().mockResolvedValue({ ok: false, json: async () => ({ factors: [] }) })

beforeEach(() => {
  vi.clearAllMocks()
  orgCount = 0
  grantCount = 0
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://proj.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'svc'
  vi.stubGlobal('fetch', fetchMock)
})

function req(path: string) {
  return new NextRequest(new URL(`https://app.test${path}`))
}

const confirmedUser = {
  id: 'u1',
  email: 'client@x.com',
  email_confirmed_at: '2026-01-01T00:00:00Z',
}

function sessionWith(user: any, aal: 'aal1' | 'aal2' = 'aal2') {
  updateSessionMock.mockResolvedValue({
    supabaseResponse: { __passthrough: true } as any,
    user,
    aal,
  })
}

describe('middleware client-grant routing', () => {
  it('no-org user WITH a client grant on a protected page → client portal (not onboarding)', async () => {
    orgCount = 0
    grantCount = 1
    sessionWith(confirmedUser)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.test/portal')
  })

  it('no-org user WITH a grant already on /portal/* → passes through', async () => {
    orgCount = 0
    grantCount = 1
    sessionWith(confirmedUser)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/portal/sites'))
    // passthrough = the supabaseResponse object, not a redirect
    expect((res as any).__passthrough).toBe(true)
  })

  it('no-org user with NO grant → onboarding (unchanged genuine-signup flow)', async () => {
    orgCount = 0
    grantCount = 0
    sessionWith(confirmedUser)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/dashboard'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.test/onboarding')
  })

  it('org member → /portal is not forced; org flow is untouched', async () => {
    orgCount = 1
    grantCount = 0
    sessionWith(confirmedUser)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/dashboard'))
    // org member on a protected page passes straight through
    expect((res as any).__passthrough).toBe(true)
  })

  it('grant-holding client landing on /onboarding → forwarded to client portal', async () => {
    orgCount = 0
    grantCount = 1
    sessionWith(confirmedUser)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/onboarding'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toBe('https://app.test/portal')
  })

  it('unauthenticated user on a protected page → login (unchanged)', async () => {
    sessionWith(null)
    const { middleware } = await import('./middleware')
    const res = await middleware(req('/portal/sites'))
    expect(res.status).toBe(307)
    expect(res.headers.get('location')).toContain('/login')
  })
})
