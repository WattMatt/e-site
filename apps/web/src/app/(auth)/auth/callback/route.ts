import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@esite/shared'

export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url)
  const code = searchParams.get('code')
  const next = searchParams.get('next') ?? '/dashboard'
  // `from` lets the caller annotate the source: 'magic_link', 'oauth_google',
  // 'email_confirmation' (signup), 'email_change_confirmation', etc.
  const from = searchParams.get('from')

  if (code) {
    const supabase = await createClient()
    const { error, data } = await supabase.auth.exchangeCodeForSession(code)
    if (!error) {
      // Audit the login. Skip when the callback was for a one-time
      // confirmation that doesn't open a session-equivalent of "logging in"
      // (email change confirmation does flip session metadata but isn't
      // really a login event — surface that separately).
      if (data.user && from !== 'email_change_confirmation') {
        const headersList = await headers()
        const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
        const ua = headersList.get('user-agent') ?? null
        await logAuthEvent(createServiceClient(), {
          userId:    data.user.id,
          eventType: 'login',
          ipAddress: ip,
          userAgent: ua,
          metadata:  { method: from ?? 'callback' },
        })
      }
      return NextResponse.redirect(`${origin}${next}`)
    }
  }

  return NextResponse.redirect(`${origin}/login?error=auth_callback_failed`)
}
