'use server'

/**
 * Marketing-email unsubscribe handler.
 *
 * The lifecycle emails render
 *   ${SITE_URL}/unsubscribe?user=<userId>
 * as their footer link, and mailbox providers reach the same URL through the
 * List-Unsubscribe / List-Unsubscribe-Post headers. This action flips
 *   public.profiles.marketing_emails_opted_out = true
 * for that user.
 *
 * OPT-OUT IS UNAUTHENTICATED BY DESIGN and runs on the service client.
 * The link must work from an inbox where the recipient is not logged in —
 * POPIA §69(3)/§11(3) and ECTA §45 require the objection mechanism to be
 * cost-free and unobstructed, and a login wall is neither. The v4 auth UUID
 * (2^128 space) is the bearer. The blast radius of a guessed UUID is a
 * suppressed marketing email, which is the outcome the data subject is
 * entitled to on request anyway.
 *
 * ⚠ It must NOT run on the anon cookie client. The only UPDATE policy on
 * public.profiles is `id = auth.uid()`; for an anonymous caller auth.uid() is
 * NULL, so the UPDATE matches zero rows, PostgREST raises no error, and a
 * result read only for `error` looks like success. That is exactly how this
 * shipped: 246 marketing sends to 36 recipients across 15 domains, and 0 of
 * 36 profiles opted out, with the page saying "You're unsubscribed" every
 * time. Hence `.select(...)` + an explicit zero-rows branch below: a write
 * that changed nothing is a failure, and must be reported as one.
 *
 * OPT-BACK-IN IS AUTHENTICATED, deliberately asymmetrically. The userId
 * appears in the URL of every marketing email ever sent, so an unauthenticated
 * service-role re-subscribe would let anyone holding a forwarded email
 * silently reverse someone's opt-out — a fresh §11(3) violation, and a worse
 * one than the bug above. It therefore requires a session whose auth.uid()
 * matches, and writes on the RLS-enforced cookie client (least privilege:
 * service-role is used only where anonymity is a requirement).
 *
 * Spec: spec-v2.md §19, §18 (POPIA-safe opt-out).
 */

import { createClient, createServiceClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  userId: z.string().uuid('Invalid unsubscribe link.'),
})

const CONTACT = 'Please email hello@e-site.live.'
const NO_MATCH =
  'We couldn’t find an account for this unsubscribe link, so nothing was changed. ' + CONTACT
const WRITE_FAILED = 'We couldn’t process your unsubscribe. ' + CONTACT

export async function optOutMarketingEmailsAction(userId: string): Promise<{
  ok: boolean
  error?: string
  email?: string
}> {
  const parsed = schema.safeParse({ userId })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid link.' }
  }

  const svc = createServiceClient()

  const { data, error } = await (svc as any)
    .from('profiles')
    .update({ marketing_emails_opted_out: true })
    .eq('id', parsed.data.userId)
    .select('id, email')
    .maybeSingle()

  if (error) {
    console.error('unsubscribe: opt-out update failed', error)
    return { ok: false, error: WRITE_FAILED }
  }

  // Zero rows matched. PostgREST reports this as data:null / error:null — the
  // silent-success shape. Never return ok:true here.
  if (!data) {
    console.error('unsubscribe: opt-out matched no profile row', { userId: parsed.data.userId })
    return { ok: false, error: NO_MATCH }
  }

  return { ok: true, email: (data as { email?: string | null }).email ?? undefined }
}

export async function optBackInMarketingEmailsAction(userId: string): Promise<{
  ok: boolean
  error?: string
}> {
  const parsed = schema.safeParse({ userId })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid link.' }

  // Re-subscribing another person is the attack this blocks. One generic
  // message for "no session" and "wrong session" — a distinct one would tell
  // an anonymous caller whether the UUID they hold is the one signed in.
  const supabase = await createClient()
  const { data: authData, error: authError } = await supabase.auth.getUser()
  const sessionUserId = authData?.user?.id
  if (authError || !sessionUserId || sessionUserId !== parsed.data.userId) {
    return {
      ok: false,
      error:
        'Sign in to the E-Site account this link belongs to, then open the link again to resubscribe.',
    }
  }

  // RLS-enforced write: the `id = auth.uid()` UPDATE policy is satisfied
  // precisely because we just proved the session owns this row.
  const { data, error } = await (supabase as any)
    .from('profiles')
    .update({ marketing_emails_opted_out: false })
    .eq('id', parsed.data.userId)
    .select('id')
    .maybeSingle()

  if (error) {
    console.error('unsubscribe: opt-back-in update failed', error)
    return { ok: false, error: 'We couldn’t update your preference. ' + CONTACT }
  }
  if (!data) {
    return { ok: false, error: NO_MATCH }
  }
  return { ok: true }
}
