import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateSession } from './lib/supabase/middleware'

// Compliance pages reached from an email inbox or from the public privacy
// notice, by a recipient who is very often NOT signed in — and who, when they
// are, is precisely the dormant account the re-engagement sequence mails.
//
// These were outside every list until 2026-09. /unsubscribe therefore 307'd to
// /login for the whole life of the lifecycle-email programme (246 marketing
// sends to 36 recipients across 15 domains, 0 opt-outs recorded), and
// /privacy/request — the POPIA §23/§24 data-subject-request intake that
// /legal/privacy directs data subjects to — was unreachable for the same
// reason. POPIA §69(3)/§11(3) and ECTA §45 require the objection mechanism to
// be cost-free and unobstructed, which a login wall is not.
//
// They must clear FOUR gates, not one: rule 1 (no session), rule 2 (signed-in
// bounce to /dashboard), rule 3 (unconfirmed email) and rule 4b (aal1 MFA).
// Adding them to PUBLIC_PATHS alone would fix rule 1 and break rule 2 for the
// one cohort that works today.
const LEGAL_PREFIXES = ['/unsubscribe', '/privacy/request', '/cookies']

const PUBLIC_PATHS = [
  '/login',
  '/signup',
  '/reset-password',
  '/auth/callback',
  '/share',
  '/account-deleted',
  '/inspection',
  // Public marketing + legal pages (PR #10, built for the Paystack KYC
  // review). Must be reachable without a session — Paystack reviewers and
  // anonymous visitors hit these without logging in.
  '/pricing',
  '/legal',         // covers /legal/acceptable-use-policy, /legal/privacy, /legal/terms
  '/sitemap.xml',
  '/robots.txt',
  ...LEGAL_PREFIXES,
]

// Exact-match public paths. `'/'.startsWith('/')` matches every URL, so the
// root landing page can't go in PUBLIC_PATHS — it needs an exact match.
const PUBLIC_EXACT_PATHS = new Set(['/'])

// Pages with no application surface — marketing and legal/compliance content.
// Accessible to anonymous AND authenticated visitors: unlike /login or /signup
// we do NOT bounce logged-in users away from these, since a logged-in user
// reading /pricing, /legal/* or /unsubscribe is legitimate. The (public)/
// page.tsx for `/` handles its own logged-in redirect at the page level.
//
// This set is also exempt from the email-verification and MFA gates. Those
// protect application data; there is none here, and both fire regardless of
// isPublicPath, so without the exemption an unconfirmed or aal1 session gets
// redirected off the unsubscribe page it was mailed a link to.
const PUBLIC_CONTENT_PREFIXES = [
  '/pricing',
  '/legal',
  '/sitemap.xml',
  '/robots.txt',
  ...LEGAL_PREFIXES,
]
const ONBOARDING_PATH = '/onboarding'
const VERIFY_EMAIL_PATH = '/verify-email'
const VERIFY_MFA_PATH = '/verify-mfa'

// API routes that authenticate via Authorization: Bearer header. They do their
// own JWT verification + same-org enforcement, so the cookie-based session
// middleware must NOT redirect them — otherwise mobile clients (Bearer-only)
// get bounced to /login. See apps/web/src/app/api/notifications/dispatch/route.ts.
// /api/diary/notify carries the same shape (mobile Bearer JWT, verified in the
// handler against Supabase Auth, then an org-membership check) and was in no
// list, so every mobile diary notification was 307'd to /login.
const SELF_AUTH_PATHS = ['/api/notifications/dispatch', '/api/diary/notify']

// Webhook endpoints authenticated by a signature over the raw request body,
// not by a session or a bearer token. They must NOT be redirected: a 307 to
// /login is recorded by the sender as a failed delivery, and after enough
// failures the provider disables the endpoint — a failure mode that looks
// exactly like the provider never sending anything.
//
// Exact paths, not prefixes: '/api/webhooks' itself is not an endpoint, and
// neither is any sub-path of a listed route. `request.nextUrl.pathname` is
// already WHATWG-normalised, so '..' segments are resolved before this
// comparison — never compare against the raw request URL here.
//
// /api/paystack/webhook was in no list at all and has therefore been 307'd
// since it shipped. Paystack is not in live mode yet, so nothing is broken
// today — but finding this during the KYC smoke test would cost a round trip
// with a payment provider.
const SIGNED_WEBHOOK_PATHS = ['/api/webhooks/resend', '/api/paystack/webhook']

// Endpoints that are public by design and carry their own unguessable bearer
// in the request itself. /api/unsubscribe is the RFC 8058 one-click target:
// the mailbox provider POSTs it with no cookies at all, so a session gate
// turns every provider-rendered Unsubscribe button into a silent no-op.
// Exact paths, same reasoning as SIGNED_WEBHOOK_PATHS above.
const PUBLIC_API_PATHS = ['/api/unsubscribe']

// Service-role client for org membership checks — bypasses RLS entirely.
// Safe because we always verify the user session via updateSession() first.
const serviceClient = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
  { auth: { persistSession: false, autoRefreshToken: false } }
)

async function hasOrg(userId: string): Promise<boolean> {
  const { count } = await serviceClient
    .from('user_organisations')
    .select('id', { count: 'exact', head: true })
    .eq('user_id', userId)
    .eq('is_active', true)
  return (count ?? 0) > 0
}

async function hasVerifiedMfaFactor(userId: string): Promise<boolean> {
  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${userId}`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        cache: 'no-store',
      },
    )
    if (!res.ok) return false
    const body = await res.json() as { factors?: { status: string }[] }
    return (body.factors ?? []).some((f) => f.status === 'verified')
  } catch {
    return false
  }
}

export async function middleware(request: NextRequest) {
  const { pathname } = request.nextUrl

  // Bypass cookie-based auth for routes that authenticate themselves via Bearer.
  // The route handler enforces its own JWT verification, same-org boundaries,
  // and rate limits. Skipping updateSession also avoids an unnecessary Supabase
  // round-trip for cookieless mobile callers.
  if (
    SELF_AUTH_PATHS.some((p) => pathname.startsWith(p)) ||
    SIGNED_WEBHOOK_PATHS.includes(pathname) ||
    PUBLIC_API_PATHS.includes(pathname)
  ) {
    return NextResponse.next()
  }

  const { supabaseResponse, user, aal } = await updateSession(request)

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p)) || PUBLIC_EXACT_PATHS.has(pathname)
  const isPublicContent =
    pathname === '/' || PUBLIC_CONTENT_PREFIXES.some((p) => pathname.startsWith(p))
  const isOnboarding = pathname.startsWith(ONBOARDING_PATH)
  const isVerifyEmail = pathname.startsWith(VERIFY_EMAIL_PATH)
  const isVerifyMfa = pathname.startsWith(VERIFY_MFA_PATH)
  const isAuthCallback = pathname.startsWith('/auth/')

  // 1. No session → login (verify-email + verify-mfa need an authenticated
  //    session even though it isn't fully elevated yet — neither is public).
  if (!user && !isPublicPath && !isVerifyEmail && !isVerifyMfa) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // 2. Has session on an auth page → dashboard. Skip /auth/callback (in-flight
  //    code exchange), /reset-password* (the OTP flow establishes a
  //    recovery session via verifyOtp, then the user sets a new password
  //    while still on /reset-password/confirm — must NOT bounce them away),
  //    and /inspection/* (public share links — signed-in users viewing a
  //    shared cert should see the same public view as anonymous visitors,
  //    not get redirected to their dashboard).
  const isResetFlow = pathname.startsWith('/reset-password')
  const isPublicShare = pathname.startsWith('/inspection')
  if (user && isPublicPath && !isAuthCallback && !isResetFlow && !isPublicShare && !isPublicContent) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.searchParams.delete('next')
    return NextResponse.redirect(url)
  }

  // 3. Authenticated + email NOT confirmed → /verify-email (skip auth/* so
  //    the confirmation callback can finish setting email_confirmed_at, and
  //    skip public content — an unconfirmed account is exactly who the
  //    re-engagement sequence mails, and their unsubscribe link must land).
  if (user && !user.email_confirmed_at && !isVerifyEmail && !isAuthCallback && !isPublicContent) {
    const url = request.nextUrl.clone()
    url.pathname = VERIFY_EMAIL_PATH
    return NextResponse.redirect(url)
  }

  // 4. On /verify-email but already confirmed → forward to onboarding/dashboard.
  if (user && isVerifyEmail && user.email_confirmed_at) {
    const url = request.nextUrl.clone()
    url.pathname = (await hasOrg(user.id)) ? '/dashboard' : ONBOARDING_PATH
    return NextResponse.redirect(url)
  }

  // 4b. MFA gate — when the session JWT is at aal1 and the user has any
  //     verified MFA factor, redirect to /verify-mfa. AAL is read off the
  //     access-token JWT (populated by updateSession); we then check
  //     listFactors via service-role to confirm a verified factor exists.
  //     listFactors is a single round-trip and only fires for aal1 sessions.
  //     Public content is exempt: it exposes no data an MFA step would
  //     protect, and gating it breaks unsubscribe for MFA-enrolled users.
  if (user && aal === 'aal1' && !isVerifyMfa && !isAuthCallback && !isPublicContent) {
    if (await hasVerifiedMfaFactor(user.id)) {
      const url = request.nextUrl.clone()
      url.pathname = VERIFY_MFA_PATH
      url.searchParams.set('next', pathname)
      return NextResponse.redirect(url)
    }
  }

  // 5. Authenticated but no org → onboarding
  if (user && !isPublicPath && !isVerifyEmail && !isVerifyMfa && !isOnboarding) {
    if (!(await hasOrg(user.id))) {
      const url = request.nextUrl.clone()
      url.pathname = ONBOARDING_PATH
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // 6. Has org + on onboarding → dashboard
  if (user && isOnboarding) {
    if (await hasOrg(user.id)) {
      const url = request.nextUrl.clone()
      url.pathname = '/dashboard'
      return NextResponse.redirect(url)
    }
  }

  return supabaseResponse
}

export const config = {
  matcher: [
    // Skip Next internals + favicon + common static asset extensions.
    // .mjs added so the pdfjs worker (/pdf.worker.min.mjs) bypasses auth.
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|mjs|map|woff2?|json|ico)$).*)',
  ],
}
