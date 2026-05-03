'use server'

/**
 * Active-session listing + sign-out-everywhere-else.
 *
 * Supabase exposes `/auth/v1/admin/users/{user_id}/sessions` (service-role)
 * for listing. Per-session DELETE isn't a public Admin API endpoint
 * — the SDK only supports user-wide signOut scopes. We expose:
 *
 *   - getActiveSessionsAction: list (read-only, informational)
 *   - signOutOthersAction: revoke all OTHER sessions, keep current
 *   - signOutEverywhereAction: revoke all sessions including current
 *
 * "Sign out everywhere else" is the more common user need; the wider
 * action is also available for "I think my password was compromised"
 * scenarios.
 */

import { headers } from 'next/headers'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'
import { logAuthEvent } from '@esite/shared'

export interface ActiveSession {
  id:           string
  created_at:   string
  updated_at:   string | null
  user_agent:   string | null
  ip:           string | null
  not_after:    string | null
  isCurrent:    boolean
}

export async function getActiveSessionsAction(): Promise<{
  sessions?: ActiveSession[]
  error?:    string
}> {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'Not authenticated.' }

  const { data: { session } } = await supabase.auth.getSession()
  const currentSessionId = session ? extractSessionId(session.access_token) : null

  try {
    const res = await fetch(
      `${process.env.NEXT_PUBLIC_SUPABASE_URL}/auth/v1/admin/users/${user.id}/sessions`,
      {
        headers: {
          Authorization: `Bearer ${process.env.SUPABASE_SERVICE_ROLE_KEY}`,
          apikey:        process.env.SUPABASE_SERVICE_ROLE_KEY!,
        },
        cache: 'no-store',
      },
    )
    if (!res.ok) {
      return { error: `Could not load sessions (HTTP ${res.status}).` }
    }
    const body = await res.json() as { sessions?: ActiveSession[] } | ActiveSession[]
    const raw  = Array.isArray(body) ? body : (body.sessions ?? [])
    const sessions = raw.map((s) => ({
      id:         s.id,
      created_at: s.created_at,
      updated_at: s.updated_at ?? null,
      user_agent: s.user_agent ?? null,
      ip:         s.ip ?? null,
      not_after:  s.not_after ?? null,
      isCurrent:  s.id === currentSessionId,
    }))
    return { sessions }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Could not load sessions.' }
  }
}

export async function signOutOthersAction(): Promise<{ ok: boolean; error?: string }> {
  return signOutWithScope('others')
}

export async function signOutEverywhereAction(): Promise<{ ok: boolean; error?: string }> {
  return signOutWithScope('global')
}

async function signOutWithScope(scope: 'others' | 'global'): Promise<{ ok: boolean; error?: string }> {
  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  const ua = headersList.get('user-agent') ?? null

  if (!rateLimit(`signout-${scope}:${ip}`, 5, 600_000)) {
    return { ok: false, error: 'Too many sign-out attempts. Please try again in a few minutes.' }
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { ok: false, error: 'Not authenticated.' }

  // Audit BEFORE the signOut so we still have the user id in scope.
  await logAuthEvent(createServiceClient(), {
    userId:    user.id,
    eventType: 'logout',
    ipAddress: ip === 'unknown' ? null : ip,
    userAgent: ua,
    metadata:  { scope },
  })

  const { error } = await supabase.auth.signOut({ scope })
  if (error) return { ok: false, error: error.message }
  return { ok: true }
}

/**
 * Extract the session id (sub-claim or session_id-claim) from the
 * Supabase access token. Used to mark the current row in the UI.
 * Best-effort — falls back to null on malformed JWT.
 */
function extractSessionId(jwt: string): string | null {
  try {
    const payloadB64 = jwt.split('.')[1]
    if (!payloadB64) return null
    const json = Buffer.from(payloadB64, 'base64url').toString('utf-8')
    const payload = JSON.parse(json) as { session_id?: string }
    return payload.session_id ?? null
  } catch {
    return null
  }
}
