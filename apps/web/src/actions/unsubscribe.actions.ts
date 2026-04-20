'use server'

/**
 * Marketing-email unsubscribe handler.
 *
 * The lifecycle emails built in Session 4 render
 *   ${SITE_URL}/unsubscribe?user=<userId>
 * as their footer link. This action flips
 *   public.profiles.marketing_emails_opted_out = true
 * for that user. No authentication required — the link must work from an
 * inbox where the recipient isn't logged in. The userId is a Supabase auth
 * UUID, which is unguessable (2^128 space).
 *
 * Spec: spec-v2.md §19, §18 (POPIA-safe opt-out).
 */

import { createClient } from '@/lib/supabase/server'
import { z } from 'zod'

const schema = z.object({
  userId: z.string().uuid('Invalid unsubscribe link.'),
})

export async function optOutMarketingEmailsAction(userId: string): Promise<{
  ok: boolean
  error?: string
  email?: string
}> {
  const parsed = schema.safeParse({ userId })
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid link.' }
  }

  const supabase = await createClient()

  // Use the anon client update — the update targets only the requested row
  // and the column has no RLS restriction on self-update. If RLS blocks it
  // (anonymous caller), bubble the error up.
  const { data, error } = await (supabase as any)
    .from('profiles')
    .update({ marketing_emails_opted_out: true })
    .eq('id', userId)
    .select('email')
    .maybeSingle()

  if (error) {
    console.error('unsubscribe: update failed', error)
    return { ok: false, error: 'We couldn\u2019t process your unsubscribe. Please email hello@e-site.co.za.' }
  }

  return { ok: true, email: (data as { email?: string } | null)?.email ?? undefined }
}

export async function optBackInMarketingEmailsAction(userId: string): Promise<{
  ok: boolean
  error?: string
}> {
  const parsed = schema.safeParse({ userId })
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? 'Invalid link.' }

  const supabase = await createClient()
  const { error } = await (supabase as any)
    .from('profiles')
    .update({ marketing_emails_opted_out: false })
    .eq('id', userId)

  if (error) {
    return { ok: false, error: 'We couldn\u2019t update your preference. Please email hello@e-site.co.za.' }
  }
  return { ok: true }
}
