// @vitest-environment node
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { NextRequest } from 'next/server'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

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

  it('passes auth-flow PUBLIC_PATHS through untouched for anonymous visitors', async () => {
    for (const p of ['/login', '/signup', '/reset-password']) {
      const res = await run(p)
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

// `run(path)` issues a GET; middleware.ts does not branch on method, so the
// bypass it proves is the same one a POST takes.
describe('signed webhook bypass', () => {
  it('lets an unauthenticated request to /api/webhooks/resend through to its handler', async () => {
    state.user = null
    const res = await run('/api/webhooks/resend')
    // Not a redirect. If this is a 307 to /login, Svix records a delivery
    // failure, retries, and eventually disables the endpoint — and the symptom
    // is indistinguishable from "Resend never sends webhooks".
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })

  it('lets an unauthenticated request to /api/paystack/webhook through — broken since it shipped', async () => {
    state.user = null
    const res = await run('/api/paystack/webhook')
    expect(res.headers.get('location')).toBeNull()
    expect(res.status).toBe(200)
  })

  it('still redirects an unauthenticated request to a neighbouring path', async () => {
    state.user = null
    const res = await run('/api/webhooks')
    expect(locationOf(res).pathname).toBe('/login')
  })

  // The assertion that kills a prefix match. `/api/webhooks` (above) does NOT
  // discriminate: it is not a prefix OF either bypassed path, so it stays
  // redirected under `startsWith` too. A sub-path of a bypassed route is the
  // only shape that separates `includes(pathname)` from
  // `some(p => pathname.startsWith(p))`.
  it('does not bypass a sub-path of a signed webhook route', async () => {
    state.user = null
    const res = await run('/api/webhooks/resend/extra')
    expect(locationOf(res).pathname).toBe('/login')
  })

  // Next parses the request URL with the WHATWG parser, so `..` segments are
  // resolved before `nextUrl.pathname` is read — the comparison never sees a
  // traversal. Pinned because the bypass would be unsafe if it were ever
  // re-expressed against the raw request URL instead of the parsed pathname.
  it('normalises traversal away before the bypass comparison sees it', async () => {
    state.user = null
    const res = await run('/api/webhooks/resend/../../something')
    expect(locationOf(res).pathname).toBe('/login')
  })
})


// ─────────────────────────────────────────────────────────────────────────────
// Contract tests. The list these replace was five hardcoded strings, so every
// public page that shipped after it was written — /cookies, /privacy/request
// and /unsubscribe among them — was outside the assertion. /unsubscribe 307'd
// to /login in production for the entire life of the lifecycle-email programme
// (246 marketing sends, 0 opt-outs) and no unit test could have noticed,
// because no unit test knew the route existed.
//
// These enumerate the filesystem instead: every page under app/(legal) and
// app/(public), and every route handler that authenticates itself. A new page
// in either group, or a new self-authenticating handler, joins the contract
// the moment its file lands.
// ─────────────────────────────────────────────────────────────────────────────

const APP_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'app')

function pagesUnder(group: string): string[] {
  const root = path.join(APP_DIR, group)
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'page.tsx' || entry.name === 'page.ts') {
        // Strip the app root and every (route group) segment; /page.tsx → ''.
        const rel = path.relative(APP_DIR, path.dirname(full))
        const segs = rel.split(path.sep).filter((s) => s && !s.startsWith('('))
        out.push('/' + segs.join('/'))
      }
    }
  }
  walk(root)
  return out.sort()
}

// Route handlers that do their own auth: a Bearer JWT they verify themselves,
// or an HMAC/Svix signature over the raw body. Both classes MUST bypass the
// cookie middleware — a 307 to /login is an auth failure for a mobile client
// and a delivery failure for a webhook provider.
function selfAuthenticatingRoutes(): string[] {
  const root = path.join(APP_DIR, 'api')
  const out: string[] = []
  const walk = (dir: string) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name)
      if (entry.isDirectory()) walk(full)
      else if (entry.name === 'route.ts') {
        const src = fs.readFileSync(full, 'utf8')
        const bearer = /headers\.get\(\s*['"][Aa]uthorization['"]/.test(src)
        const signature =
          /x-paystack-signature|svix-signature|createHmac|new Webhook\(/i.test(src)
        if (bearer || signature) {
          out.push('/' + path.relative(APP_DIR, path.dirname(full)).split(path.sep).join('/'))
        }
      }
    }
  }
  walk(root)
  return out.sort()
}

const LEGAL_PAGES = pagesUnder('(legal)')
const PUBLIC_PAGES = pagesUnder('(public)')
const PUBLIC_CONTENT_PAGES = [...LEGAL_PAGES, ...PUBLIC_PAGES]

describe('middleware — public-content contract (app/(legal) + app/(public))', () => {
  it('enumerates the groups from disk, and they are not empty', () => {
    expect(LEGAL_PAGES.length).toBeGreaterThan(0)
    expect(PUBLIC_PAGES.length).toBeGreaterThan(0)
    // Pins the routes this finding is about, so a rename cannot quietly empty
    // the enumeration and leave the suite green over nothing.
    expect(LEGAL_PAGES).toEqual(
      expect.arrayContaining(['/cookies', '/privacy/request', '/unsubscribe']),
    )
    expect(PUBLIC_PAGES).toEqual(expect.arrayContaining(['/', '/pricing', '/legal/terms']))
  })

  it.each(PUBLIC_CONTENT_PAGES)('%s is reachable by an anonymous visitor', async (route) => {
    state.user = null
    const res = await run(route)
    // The sentinel is only returned on a pass-through; a redirect would be a
    // NextResponse with a Location header, never this object.
    expect(res).toBe(state.supabaseResponse)
  })

  it.each(PUBLIC_CONTENT_PAGES)('%s is NOT bounced to /dashboard when signed in', async (route) => {
    state.user = CONFIRMED
    state.aal = 'aal2'
    state.orgCount = 1
    const res = await run(route)
    // The sentinel is only returned on a pass-through; a redirect would be a
    // NextResponse with a Location header, never this object.
    expect(res).toBe(state.supabaseResponse)
  })

  // Rule 3 and rule 4b fire regardless of isPublicPath, and they target exactly
  // the cohort the re-engagement sequence mails: dormant accounts. An
  // unsubscribe link that lands on /verify-email is an unsubscribe link that
  // does not work.
  it.each(PUBLIC_CONTENT_PAGES)('%s is NOT intercepted by the unconfirmed-email gate', async (route) => {
    state.user = { id: 'user-1' } // no email_confirmed_at
    state.aal = 'aal2'
    state.orgCount = 1
    const res = await run(route)
    // The sentinel is only returned on a pass-through; a redirect would be a
    // NextResponse with a Location header, never this object.
    expect(res).toBe(state.supabaseResponse)
  })

  it.each(PUBLIC_CONTENT_PAGES)('%s is NOT intercepted by the aal1 MFA gate', async (route) => {
    state.user = CONFIRMED
    state.aal = 'aal1'
    state.orgCount = 1
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: true, json: async () => ({ factors: [{ status: 'verified' }] }) })),
    )
    const res = await run(route)
    // The sentinel is only returned on a pass-through; a redirect would be a
    // NextResponse with a Location header, never this object.
    expect(res).toBe(state.supabaseResponse)
  })

  // The control. Without this, "everything passes through" would satisfy every
  // assertion above, and the contract would be decorative.
  it('still redirects an anonymous visitor on a protected path', async () => {
    state.user = null
    const res = await run('/settings/billing')
    expect(locationOf(res).pathname).toBe('/login')
  })
})

describe('middleware — self-authenticating route contract (app/api)', () => {
  const routes = selfAuthenticatingRoutes()

  it('finds the handlers that carry their own auth', () => {
    expect(routes).toEqual(
      expect.arrayContaining([
        '/api/notifications/dispatch',
        '/api/paystack/webhook',
        '/api/webhooks/resend',
      ]),
    )
  })

  it.each(routes)('%s is never redirected by the cookie middleware', async (route) => {
    state.user = null
    const res = await run(route)
    expect(res.headers.get('location')).toBeNull()
  })
})

describe('middleware — one-click unsubscribe endpoint', () => {
  // RFC 8058: the mailbox provider POSTs here with no session and no cookies.
  // A 307 to /login is recorded as a failed one-click, and the provider stops
  // offering the control — the same silent-failure shape as the page itself.
  it('never redirects an anonymous POST to /api/unsubscribe', async () => {
    state.user = null
    const res = await run('/api/unsubscribe?user=018f2d31-bbe8-4cc1-bbdd-63af0187081e')
    expect(res.headers.get('location')).toBeNull()
  })

  it('does not bypass a neighbouring path', async () => {
    state.user = null
    const res = await run('/api/unsubscribes')
    expect(locationOf(res).pathname).toBe('/login')
  })
})

