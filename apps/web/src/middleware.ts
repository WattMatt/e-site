import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateSession } from './lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/signup', '/reset-password', '/auth/callback', '/share', '/account-deleted']
const ONBOARDING_PATH = '/onboarding'
const VERIFY_EMAIL_PATH = '/verify-email'

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

export async function middleware(request: NextRequest) {
  const { supabaseResponse, user } = await updateSession(request)
  const { pathname } = request.nextUrl

  const isPublicPath = PUBLIC_PATHS.some((p) => pathname.startsWith(p))
  const isOnboarding = pathname.startsWith(ONBOARDING_PATH)
  const isVerifyEmail = pathname.startsWith(VERIFY_EMAIL_PATH)
  const isAuthCallback = pathname.startsWith('/auth/')

  // 1. No session → login (verify-email needs an authenticated session even
  //    though the email isn't confirmed yet, so it's NOT a public path).
  if (!user && !isPublicPath && !isVerifyEmail) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // 2. Has session on auth page → dashboard
  if (user && isPublicPath && !isAuthCallback) {
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

  // 5. Authenticated but no org → onboarding
  if (user && !isPublicPath && !isVerifyEmail && !isOnboarding) {
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
