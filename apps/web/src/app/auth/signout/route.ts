import { headers } from 'next/headers'
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent } from '@esite/shared'

export async function POST(request: Request) {
  // Tenderers sign out back to their own page; nothing else is accepted as a destination.
  const form = await request.formData().catch(() => null)
  const to = form?.get('to') === '/tender/login' ? '/tender/login' : '/login'
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
  // A RELATIVE Location: the browser resolves it against the address it
  // actually posted to. The CSP's form-action 'self' blocks a form redirect to
  // any other host, and neither NEXT_PUBLIC_SITE_URL nor request.url (Next
  // reports its own host there) is reliably the one the browser used.
  return new NextResponse(null, { status: 303, headers: { Location: to } })
}
