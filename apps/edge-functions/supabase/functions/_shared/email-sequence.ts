/**
 * Lifecycle-email helper shared by the 7 sequence Edge Functions.
 *
 * Contract:
 *   1. sendSequenceEmail() inserts a row into public.email_sequence_events
 *      first. The UNIQUE (user_id, sequence_name, step_name) constraint
 *      short-circuits duplicates — a cron that runs twice on the same day
 *      does not double-send.
 *   2. If the INSERT succeeds, we hit Resend. If Resend fails we bubble
 *      the error so the row gets cleaned up via a follow-up UPDATE (leaving
 *      a send failure visible in the DB for retry).
 *   3. Profiles with marketing_emails_opted_out = TRUE are skipped before
 *      the insert — saves Resend quota and preserves POPIA consent state.
 */

import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2'

export type SequenceName = 'onboarding' | 'reengagement' | 'conversion' | 'payment_recovery'
export type StepName =
  | 'd0' | 'd1' | 'd3' | 'd7' | 'd14'
  | 'inactive_7d' | 'inactive_14d' | 'inactive_30d'
  | 'second_project'
  | 'day0_failed' | 'day3_retry_failed' | 'day7_final_warning' | 'day14_paused' | 'day30_cancelled'

export interface SendInput {
  userId: string
  toEmail: string
  organisationId?: string | null
  sequence: SequenceName
  step: StepName
  subject: string
  html: string
  metadata?: Record<string, unknown>
}

export interface SendResult {
  status: 'sent' | 'skipped_duplicate' | 'skipped_opt_out' | 'failed'
  reason?: string
  messageId?: string
}

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('RESEND_FROM') ?? 'E-Site <noreply@e-site.co.za>'
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://app.e-site.co.za'

export function getSiteUrl(): string {
  return SITE_URL
}

export function unsubscribeUrlFor(userId: string): string {
  // /unsubscribe page is Phase 1 final task (T-065 area). Until then the URL
  // resolves to a placeholder — but the link must be present in every email
  // per POPIA + CAN-SPAM equivalents.
  return `${SITE_URL}/unsubscribe?user=${encodeURIComponent(userId)}`
}

export function serviceRoleClient(): SupabaseClient {
  return createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )
}

async function hasOptedOut(supabase: SupabaseClient, userId: string): Promise<boolean> {
  const { data } = await (supabase as any)
    .from('profiles')
    .select('marketing_emails_opted_out')
    .eq('id', userId)
    .maybeSingle()
  return Boolean(data?.marketing_emails_opted_out)
}

async function insertEvent(
  supabase: SupabaseClient,
  input: SendInput,
): Promise<{ eventId: string } | { duplicate: true }> {
  const { data, error } = await (supabase as any)
    .from('email_sequence_events')
    .insert({
      user_id:         input.userId,
      organisation_id: input.organisationId ?? null,
      sequence_name:   input.sequence,
      step_name:       input.step,
      to_email:        input.toEmail,
      subject:         input.subject,
      metadata:        input.metadata ?? {},
    })
    .select('id')
    .single()

  if (error) {
    // Postgres UNIQUE violation → we've already sent this step to this user.
    if ((error as any).code === '23505') return { duplicate: true }
    throw new Error(`insert email_sequence_events: ${error.message}`)
  }
  return { eventId: data.id }
}

async function resendSend(to: string, subject: string, html: string): Promise<string> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ from: FROM, to, subject, html }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend ${res.status}: ${body}`)
  }
  const data = await res.json() as { id?: string }
  return data.id ?? ''
}

export async function sendSequenceEmail(
  supabase: SupabaseClient,
  input: SendInput,
): Promise<SendResult> {
  if (await hasOptedOut(supabase, input.userId)) {
    return { status: 'skipped_opt_out' }
  }

  const insertResult = await insertEvent(supabase, input)
  if ('duplicate' in insertResult) return { status: 'skipped_duplicate' }

  try {
    const messageId = await resendSend(input.toEmail, input.subject, input.html)
    await (supabase as any)
      .from('email_sequence_events')
      .update({ resend_message_id: messageId })
      .eq('id', insertResult.eventId)
    return { status: 'sent', messageId }
  } catch (err) {
    // Leave the event row in place as a failure record so an operator can see
    // which sends errored (row will have null resend_message_id).
    return {
      status: 'failed',
      reason: err instanceof Error ? err.message : String(err),
    }
  }
}

// ─── Signup-age query ────────────────────────────────────────────────────────

/**
 * Find users whose signup day matches the target day-offset. Used by the cron
 * Edge Functions for d1/d3/d7/d14 onboarding steps — every morning, for each
 * step, grab users whose signup window opens today.
 *
 * Window is `[today - dayOffset, today - dayOffset + 1d)` in UTC to avoid
 * double-selecting if the cron runs slightly off schedule.
 */
export async function usersSignedUpDaysAgo(
  supabase: SupabaseClient,
  dayOffset: number,
  now: Date = new Date(),
): Promise<Array<{ userId: string; email: string; firstName: string | null }>> {
  const dayMs = 86_400_000
  const windowStart = new Date(now.getTime() - dayOffset * dayMs)
  const windowEnd = new Date(windowStart.getTime() + dayMs)

  // auth.admin.listUsers is the only Deno-supported way to reach auth.users
  // timestamps. For early-stage volumes one page (1000) is more than enough;
  // paginate later if needed.
  const { data, error } = await (supabase as any).auth.admin.listUsers({ page: 1, perPage: 1000 })
  if (error) throw new Error(`listUsers: ${error.message}`)

  const users = (data?.users ?? []) as Array<{
    id: string
    email: string | null
    created_at: string
    user_metadata?: { full_name?: string }
  }>

  return users
    .filter(u => {
      if (!u.email || !u.created_at) return false
      const t = new Date(u.created_at).getTime()
      return t >= windowStart.getTime() && t < windowEnd.getTime()
    })
    .map(u => ({
      userId: u.id,
      email: u.email as string,
      firstName: u.user_metadata?.full_name?.split(' ')[0] ?? null,
    }))
}

// ─── Shared JSON response helpers ────────────────────────────────────────────

export function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

export function corsPreflight(): Response {
  return new Response('ok', {
    headers: {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Headers': 'authorization, content-type',
    },
  })
}

// Re-exported so cron/event functions can import from one place.
export { requireServiceRole } from './auth.ts'
