'use server'

/**
 * Best-effort auth audit event recorder. Called from client auth flows
 * (login, logout, password change, password-reset request) right after
 * the matching Supabase API call succeeds.
 *
 * Insert path goes through service-role; client never writes to
 * auth_events directly. Failures are swallowed and logged — the audit
 * trail is non-blocking by design.
 */

import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { logAuthEvent, type AuthEventType } from '@esite/shared'

const SAFE_EVENTS: ReadonlySet<AuthEventType> = new Set([
  'login',
  'logout',
  'password_changed',
  'password_reset_requested',
])

export async function recordAuthEventAction(
  eventType: AuthEventType,
  metadata?: Record<string, unknown>,
): Promise<void> {
  if (!SAFE_EVENTS.has(eventType)) return

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? null
  const ua = headersList.get('user-agent') ?? null

  // password_reset_requested is anonymous (no session yet); the others
  // require an authenticated user. We pull userId from the session when
  // we have one and fall back to null otherwise.
  let userId: string | null = null
  if (eventType !== 'password_reset_requested') {
    const supabase = await createClient()
    const { data: { user } } = await supabase.auth.getUser()
    userId = user?.id ?? null
  }

  const service = createServiceClient()
  await logAuthEvent(service, {
    userId,
    eventType,
    ipAddress: ip,
    userAgent: ua,
    metadata: metadata ?? {},
  })
}
