'use server'

/**
 * Day-0 welcome email trigger.
 *
 * Why this file exists. `signup/page.tsx` is a client component, and it used
 * to fire the welcome itself:
 *
 *     void supabase.functions.invoke('onboarding-email-d0', { body: {...} })
 *       .catch(() => {})
 *
 * with the BROWSER client, whose Authorization is the anon key (or, moments
 * after signUp, the new user's own token). `onboarding-email-d0`'s first act is
 * `requireServiceRole`, which 403s anything whose role claim is not
 * service_role. And `functions.invoke` RESOLVES with `{ data, error }` rather
 * than rejecting, so the `.catch` never ran: no console error, no Sentry, no
 * symptom. Production proof that it never once executed —
 * `public.email_sequence_events` holds d1=33, d3=36, d7=36, d14=36,
 * inactive_7d/14d/30d, and ZERO d0 rows across 2026-04-20 → 2026-08-30, even
 * though `sendSequenceEmail` inserts the event row BEFORE it calls Resend.
 *
 * SECURITY — read before widening the signature.
 *
 * The service-role key cannot go to the browser, so the trigger moves here.
 * That makes this action the thing standing where `requireServiceRole` stood,
 * and a server action is directly invocable by anyone who can POST to the app.
 * Four guards, all covered by onboarding-email.actions.test.ts:
 *
 *   1. It takes ONE argument, a userId. A caller can never name a recipient.
 *   2. The address and name are re-read from the auth admin API, so the mail
 *      goes where the account says, not where the body says.
 *   3. The account must have been created in the last few minutes. Without
 *      this, anyone holding a user id could mail the entire existing user base
 *      a "thanks for signing up" welcome.
 *   4. Per-IP rate limit, same helper the auth-event recorder uses.
 *
 * Idempotence is the edge function's job and it already has it: the UNIQUE
 * (user_id, sequence_name, step_name) index on email_sequence_events means a
 * second call for the same user returns `skipped_duplicate` without sending.
 *
 * NOT a database trigger or a day-0 cron, deliberately: 35 of 36 accounts were
 * admin-created and belong to the branded invite flow. A trigger on
 * auth.users would mail them "thanks for signing up, your first project is
 * free". Only the self-serve signup form calls this.
 */

import { headers } from 'next/headers'
import { createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

/** How recently the account must have been created for a welcome to make sense. */
export const D0_FRESH_SIGNUP_WINDOW_MS = 15 * 60_000

/** Per-IP ceiling. A real signup fires this once. */
const D0_RATE_LIMIT = 5
const D0_RATE_WINDOW_MS = 10 * 60_000

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export type WelcomeEmailOutcome =
  | 'sent'
  | 'skipped_duplicate'
  | 'skipped_opt_out'
  | 'not_a_fresh_signup'
  | 'unknown_user'
  | 'rate_limited'
  | 'failed'

export interface WelcomeEmailResult {
  outcome: WelcomeEmailOutcome
  reason?: string
}

export async function sendWelcomeEmailAction(userId: string): Promise<WelcomeEmailResult> {
  if (typeof userId !== 'string' || !UUID_RE.test(userId)) {
    return { outcome: 'unknown_user', reason: 'malformed id' }
  }

  const headersList = await headers()
  const ip = headersList.get('x-forwarded-for')?.split(',')[0]?.trim() ?? 'unknown'
  if (!rateLimit(`welcome-email:${ip}`, D0_RATE_LIMIT, D0_RATE_WINDOW_MS)) {
    return { outcome: 'rate_limited' }
  }

  const service = createServiceClient()

  // Recipient comes from the account, never from the caller.
  const { data, error } = await service.auth.admin.getUserById(userId)
  const user = data?.user
  if (error || !user?.email) {
    return { outcome: 'unknown_user', reason: error?.message }
  }

  const createdAt = Date.parse(user.created_at ?? '')
  if (!Number.isFinite(createdAt) || Date.now() - createdAt > D0_FRESH_SIGNUP_WINDOW_MS) {
    return { outcome: 'not_a_fresh_signup' }
  }

  const fullName = (user.user_metadata as { full_name?: string } | null)?.full_name ?? ''

  // Service client → Authorization is the service-role key → the edge
  // function's requireServiceRole gate passes. This is the whole fix.
  const { data: fnData, error: fnError } = await service.functions.invoke('onboarding-email-d0', {
    body: { userId, email: user.email, firstName: fullName.split(' ')[0] ?? '' },
  })

  // Awaited and logged. The previous floating `.catch` is precisely why a
  // 100% failure rate went unnoticed for four months.
  if (fnError) {
    console.error('[welcome-email] onboarding-email-d0 rejected the call', {
      userId,
      error: fnError instanceof Error ? fnError.message : String(fnError),
    })
    return { outcome: 'failed', reason: 'edge function error' }
  }

  const status = (fnData as { status?: string } | null)?.status
  if (status === 'skipped_duplicate' || status === 'skipped_opt_out') {
    return { outcome: status }
  }
  if (status === 'failed') {
    console.error('[welcome-email] onboarding-email-d0 could not send', {
      userId,
      reason: (fnData as { reason?: string }).reason,
    })
    return { outcome: 'failed', reason: (fnData as { reason?: string }).reason }
  }
  return { outcome: 'sent' }
}
