import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@esite/shared'

export async function POST() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Audit BEFORE signOut so we still have the user id in scope.
  if (user) {
    const headersList = await headers()
    const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
    const ua = headersList.get('user-agent') ?? null
    await logAuthEvent(createServiceClient(), {
      userId:    user.id,
      eventType: 'logout',
      ipAddress: ip,
      userAgent: ua,
    })
  }

  await supabase.auth.signOut()
  return NextResponse.redirect(new URL('/login', process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'))
}
