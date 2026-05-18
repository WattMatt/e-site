import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateSession } from './lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/signup', '/reset-password', '/auth/callback', '/share', '/account-deleted', '/inspection']
const ONBOARDING_PATH = '/onboarding'
const VERIFY_EMAIL_PATH = '/verify-email'
const VERIFY_MFA_PATH = '/verify-mfa'

// API routes that authenticate via Authorization: Bearer header. They do their
// own JWT verification + same-org enforcement, so the cookie-based session
// middleware must NOT redirect them — otherwise mobile clients (Bearer-only)
// get bounced to /login. See apps/web/src/app/api/notifications/dispatch/route.ts.
const SELF_AUTH_PATHS = ['/api/notifications/dispatch']

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
  if (SELF_AUTH_PATHS.some((p) => pathname.startsWith(p))) {
    return NextResponse.next()
  }

  const { supabaseResponse, user, aal } = await updateSession(request)

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
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
  if (user && isPublicPath && !isAuthCallback && !isResetFlow && !isPublicShare) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.searchParams.delete('next')
    return NextResponse.redirect(url)
  }

  // 3. Authenticated + email NOT confirmed → /verify-email (skip auth/* so
  //    the confirmation callback can finish setting email_confirmed_at).
  if (user && !user.email_confirmed_at && !isVerifyEmail && !isAuthCallback) {
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
  if (user && aal === 'aal1' && !isVerifyMfa && !isAuthCallback) {
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
