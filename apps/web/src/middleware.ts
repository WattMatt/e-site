import { type NextRequest, NextResponse } from 'next/server'
import { createClient } from '@supabase/supabase-js'
import { updateSession } from './lib/supabase/middleware'

const PUBLIC_PATHS = ['/login', '/signup', '/reset-password', '/auth/callback', '/share']
const ONBOARDING_PATH = '/onboarding'

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

  // 1. No session → login
  if (!user && !isPublicPath) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    url.searchParams.set('next', pathname)
    return NextResponse.redirect(url)
  }

  // 2. Has session on auth page → dashboard
  if (user && isPublicPath && !pathname.startsWith('/auth/callback')) {
    const url = request.nextUrl.clone()
    url.pathname = '/dashboard'
    url.searchParams.delete('next')
    return NextResponse.redirect(url)
  }

  // 3. Authenticated but no org → onboarding
  if (user && !isPublicPath && !isOnboarding) {
    if (!(await hasOrg(user.id))) {
      const url = request.nextUrl.clone()
      url.pathname = ONBOARDING_PATH
      return NextResponse.redirect(url)
    }
    return supabaseResponse
  }

  // 4. Has org + on onboarding → dashboard
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
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)',
  ],
}
