import { createServerClient, type CookieOptions } from '@supabase/ssr'
import { type NextRequest, NextResponse } from 'next/server'
import type { Database } from '@esite/db'
import type { SupabaseClient } from '@supabase/supabase-js'

interface JwtClaims {
  aal?: 'aal1' | 'aal2'
  amr?: { method: string }[]
}

function decodeAccessTokenClaims(token: string): JwtClaims | null {
  try {
    const payloadB64 = token.split('.')[1]
    if (!payloadB64) return null
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    return JSON.parse(json) as JwtClaims
  } catch {
    return null
  }
}

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet: { name: string; value: string; options: CookieOptions }[]) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  ) as unknown as SupabaseClient<Database>

  // Refresh the session — MUST be called before any redirect
  const {
    data: { user },
  } = await supabase.auth.getUser()

  // Seed the theme cookie for already-authenticated sessions that predate the
  // feature (or arrived without hitting the auth callback). Only runs when the
  // cookie is absent, so it fires at most once per device, then the long-lived
  // cookie carries it.
  if (user && !request.cookies.get('theme')) {
    const { data } = await supabase.from('profiles')
      .select('theme_preference').eq('id', user.id).single()
    const mode = data?.theme_preference
    if (mode === 'light' || mode === 'dark' || mode === 'system') {
      supabaseResponse.cookies.set('theme', mode, {
        path: '/', maxAge: 60 * 60 * 24 * 365, sameSite: 'lax',
      })
    }
  }

  // Decode aal/amr from the access-token JWT for the MFA gate. user.factors
  // / user.amr are not reliably populated by getUser(); the canonical
  // location is the JWT itself.
  let aal: JwtClaims['aal'] | null = null
  let amr: JwtClaims['amr'] | null = null
  if (user) {
    const { data: { session } } = await supabase.auth.getSession()
    const claims = session ? decodeAccessTokenClaims(session.access_token) : null
    aal = claims?.aal ?? null
    amr = claims?.amr ?? null
  }

  return { supabaseResponse, user, aal, amr }
}
