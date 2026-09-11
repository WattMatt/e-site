/**
 * Lifecycle-email helper shared by the 7 sequence Edge Functions.
 *
 * Contract:
 *   1. Profiles with marketing_emails_opted_out = TRUE are skipped first —
 *      POPIA consent state, checked before anything else happens.
 *   2. Addresses on public.email_suppressions are skipped next, before the
 *      event row is written and before Resend is called. The consult FAILS
 *      OPEN: a read error allows the send. See isAddressSuppressed().
 *   3. sendSequenceEmail() then inserts a row into public.email_sequence_events
 *      with status = 'pending', BEFORE hitting Resend. The insert-first order
 *      is deliberate and must stay: resendSend() throws on any fetch rejection,
 *      including a timeout that arrives AFTER Resend has already accepted the
 *      message, so the failure mode has to be "possibly not sent" rather than
 *      "possibly sent twice".
 *   4. The row is then stamped with the outcome — 'sent', 'failed' (+ reason),
 *      or 'send_id_unrecorded'. See the status ledger below.
 *   5. UNIQUE (user_id, sequence_name, step_name) still makes a step
 *      once-ever per user. On a 23505 we read the existing row back and retry
 *      ONLY a row we know failed, by UPDATE (a second INSERT is impossible).
 *
 * ── The status ledger, and why it exists ────────────────────────────────────
 *
 * Before this, the row was inserted before the send and deliberately left in
 * place on failure, so the next run collided on the UNIQUE key and returned
 * skipped_duplicate forever: a failed send was permanently recorded as a
 * completed step. 11 production rows (2026-04-20 → 04-27, a one-week
 * unverified-sender-domain outage) carry a NULL resend_message_id and none of
 * them could ever be retried. The success-path UPDATE that wrote the message id
 * also discarded its own error, so a NULL id did not even reliably mean the
 * send had failed.
 *
 *   pending              inserted, outcome unknown. NEVER retried — the process
 *                        may have died after Resend accepted the message.
 *   sent                 Resend returned 2xx. Never retried.
 *   failed               Resend refused, or the request never completed.
 *                        The ONLY retryable state.
 *   send_id_unrecorded   Resend returned 2xx but we could not write the outcome
 *                        back. The mail WENT OUT. Never retried.
 *
 * Retry is bounded twice over, because a lifecycle email is time-relevant and a
 * stale one is worse than a missing one: RETRY_WINDOW_MS from the row's
 * original sent_at, and MAX_SEND_ATTEMPTS in total. Both bounds are what make
 * the migration-00188 backfill of those 11 April rows to 'failed' safe — they
 * are months outside the window, so they are honest evidence rather than a
 * queue of five-month-old mail waiting to go out.
 *
 * ⚠ FOLLOW-UP, not fixed here: the seven calling index.ts functions tally
 * results with `if sent / else if skipped_opt_out / else if skipped_duplicate /
 * else failed++`, so the new 'skipped_suppressed' lands in their `failed`
 * bucket with reason 'suppressed'. Readable, but it inflates the failure count
 * in the cron response until each caller grows a branch for it. Those files are
 * outside this change.
 *
 * ⚠ Deno. Nothing here is deployed by merging — the sequence functions are
 * CLI-deployed and are NOT in deploy-edge-functions.yml.
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
  status: 'sent' | 'skipped_duplicate' | 'skipped_opt_out' | 'skipped_suppressed' | 'failed'
  reason?: string
  messageId?: string
}

/** Lifecycle of one email_sequence_events row. See the ledger in the header. */
export type SendRowStatus = 'pending' | 'sent' | 'failed' | 'send_id_unrecorded'

/**
 * How many times we will ever hand one (user, sequence, step) to Resend.
 * The first attempt counts, so 3 means the original plus two retries.
 */
export const MAX_SEND_ATTEMPTS = 3

/**
 * How long after the row's original sent_at a failed step may still be retried.
 * A lifecycle email is time-relevant — "Two weeks in — how is E-Site working
 * for you?" arriving five months late is worse than never arriving — so a
 * failure that is not repaired quickly is left as evidence, not as a queue.
 */
export const RETRY_WINDOW_MS = 3 * 86_400_000

const RESEND_API_KEY = Deno.env.get('RESEND_API_KEY')
const FROM = Deno.env.get('RESEND_FROM') ?? 'E-Site <noreply@e-site.live>'
// www is canonical. app.e-site.live has no DNS record and is the host that
// dead-ended every invite link in PR #138; a fallback to it produces mail whose
// buttons go nowhere, with "nobody clicks" as the only symptom.
const SITE_URL = Deno.env.get('SITE_URL') ?? 'https://www.e-site.live'

export function getSiteUrl(): string {
  return SITE_URL
}

export function unsubscribeUrlFor(userId: string): string {
  // Human-facing footer link: a GET that renders confirmation.
  return `${SITE_URL}/unsubscribe?user=${encodeURIComponent(userId)}`
}

// RFC 8058 one-click target. A POST endpoint, NOT the page — App Router pages
// answer GET only, so pointing the header at /unsubscribe would make every
// provider-rendered click a 405. Kept as a named export so the cross-file
// contract test can check it resolves to a real route handler that the
// middleware does not redirect.
export const ONE_CLICK_UNSUBSCRIBE_PATH = '/api/unsubscribe'

/**
 * List-Unsubscribe (RFC 2369) + List-Unsubscribe-Post (RFC 8058).
 *
 * Why these exist at all: the footer link alone is a link inside HTML that a
 * recipient has to find. With these headers Gmail, Outlook and Yahoo render
 * their own Unsubscribe control at the top of the message, and — this is the
 * part that matters for deliverability — a recipient who has that control is
 * far less likely to reach for "mark as spam" instead. Every spam complaint
 * lands against the same e-site.live sending reputation that carries password
 * resets and project invites.
 *
 * Before this, resendSend posted from/to/subject/html only. There was no
 * header, the page behind the footer link 307'd to /login, and the write
 * behind the page matched zero rows: 246 marketing sends, 36 recipients,
 * 0 opt-outs, and no way for anyone to record one.
 *
 * `List-Unsubscribe-Post` must be exactly `List-Unsubscribe=One-Click`; any
 * other spelling is silently treated as no one-click support.
 */
export function listUnsubscribeHeaders(userId: string): Record<string, string> {
  const oneClick =
    `${SITE_URL}${ONE_CLICK_UNSUBSCRIBE_PATH}?user=${encodeURIComponent(userId)}`
  return {
    'List-Unsubscribe': `<${oneClick}>`,
    'List-Unsubscribe-Post': 'List-Unsubscribe=One-Click',
  }
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

/**
 * The bounce/complaint suppression consult (public.email_suppressions, created
 * in migration 00185). Mirrors the contract documented in
 * packages/shared/src/email/suppression.ts — that file cannot be imported here,
 * because these are Deno modules with no bundler.
 *
 * FAIL OPEN, on purpose. Failing closed on a read error would silence every
 * outbound lifecycle email simultaneously — an invisible total outage. Mailing
 * a handful of dead addresses until the error is fixed is the cheaper failure,
 * and it is self-announcing: it produces more bounce events, which is exactly
 * what feeds this table.
 */
async function isAddressSuppressed(
  supabase: SupabaseClient,
  emailAddress: string,
): Promise<boolean> {
  const address = (emailAddress ?? '').trim().toLowerCase()
  if (!address) return false

  const { data, error } = await (supabase as any)
    .from('email_suppressions')
    .select('email_address')
    .eq('email_address', address)
    .maybeSingle()

  if (error) {
    console.error('isAddressSuppressed: read failed, allowing the send', error)
    return false
  }
  return data !== null
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
      status:          'pending',
      send_attempts:   1,
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

async function resendSend(
  to: string,
  subject: string,
  html: string,
  headers?: Record<string, string>,
): Promise<string> {
  if (!RESEND_API_KEY) throw new Error('RESEND_API_KEY not set')
  const res = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${RESEND_API_KEY}`,
      'Content-Type': 'application/json',
    },
    // `headers` here is the custom-header map Resend injects into the outbound
    // MIME message — not the headers of this API call.
    body: JSON.stringify({ from: FROM, to, subject, html, headers }),
  })
  if (!res.ok) {
    const body = await res.text()
    throw new Error(`Resend ${res.status}: ${body}`)
  }
  const data = await res.json() as { id?: string }
  return data.id ?? ''
}

/**
 * Write the outcome of an attempt onto its event row.
 *
 * Returns the write error rather than throwing: the caller has already decided
 * what happened to the email, and a bookkeeping failure must not change that
 * verdict into its opposite.
 */
async function stampOutcome(
  supabase: SupabaseClient,
  eventId: string,
  patch: Record<string, unknown>,
): Promise<{ error: unknown }> {
  const { error } = await (supabase as any)
    .from('email_sequence_events')
    .update(patch)
    .eq('id', eventId)
  return { error }
}

type Slot =
  | { kind: 'claimed'; eventId: string }
  | { kind: 'skip'; reason: string }

/**
 * Claim the right to send this (user, sequence, step) exactly once.
 *
 * Normal path: INSERT a 'pending' row. On 23505 the step already has a row, so
 * read it back and decide. The ONLY state we retry is 'failed', and only inside
 * both bounds — everything else is either done or unknown, and a double-send of
 * a real email cannot be undone.
 *
 * The retry is claimed with a conditional UPDATE (… WHERE id = ? AND status =
 * 'failed') returning the row, so two cron runs overlapping cannot both send.
 * Zero rows returned means someone else won; we skip.
 */
async function claimSendSlot(
  supabase: SupabaseClient,
  input: SendInput,
): Promise<Slot> {
  const inserted = await insertEvent(supabase, input)
  if (!('duplicate' in inserted)) return { kind: 'claimed', eventId: inserted.eventId }

  const { data: existing, error } = await (supabase as any)
    .from('email_sequence_events')
    .select('id, status, sent_at, send_attempts')
    .eq('user_id', input.userId)
    .eq('sequence_name', input.sequence)
    .eq('step_name', input.step)
    .maybeSingle()

  // Cannot read the row → cannot prove it failed → do not send. Unknown is
  // treated exactly like 'pending'.
  if (error || !existing) return { kind: 'skip', reason: 'duplicate_unreadable' }

  const row = existing as {
    id: string
    status: SendRowStatus | null
    sent_at: string | null
    send_attempts: number | null
  }

  // A row predating migration 00188 has a NULL status. It is backfilled there,
  // but if one is ever seen here it is 'unknown', not 'failed'.
  if (row.status !== 'failed') return { kind: 'skip', reason: `already_${row.status ?? 'unknown'}` }

  const attempts = row.send_attempts ?? 1
  if (attempts >= MAX_SEND_ATTEMPTS) return { kind: 'skip', reason: 'attempts_exhausted' }

  const firstAttemptAt = row.sent_at ? new Date(row.sent_at).getTime() : 0
  if (!firstAttemptAt || Date.now() - firstAttemptAt > RETRY_WINDOW_MS) {
    return { kind: 'skip', reason: 'retry_window_elapsed' }
  }

  // sent_at is deliberately NOT moved. It is the anchor the retry window is
  // measured from, so refreshing it on each attempt would make a permanently
  // failing address retryable forever.
  const { data: claimed, error: claimError } = await (supabase as any)
    .from('email_sequence_events')
    .update({ status: 'pending', send_attempts: attempts + 1, failure_reason: null })
    .eq('id', row.id)
    .eq('status', 'failed')
    .select('id')

  if (claimError) return { kind: 'skip', reason: 'claim_failed' }
  if (!Array.isArray(claimed) || claimed.length === 0) {
    return { kind: 'skip', reason: 'claimed_elsewhere' }
  }
  return { kind: 'claimed', eventId: row.id }
}

export async function sendSequenceEmail(
  supabase: SupabaseClient,
  input: SendInput,
): Promise<SendResult> {
  if (await hasOptedOut(supabase, input.userId)) {
    return { status: 'skipped_opt_out' }
  }

  // Before the row is written and before Resend is called: a suppressed address
  // must not burn the once-ever (user, sequence, step) slot, or the step could
  // never be sent if the address is later un-suppressed.
  if (await isAddressSuppressed(supabase, input.toEmail)) {
    return { status: 'skipped_suppressed', reason: 'suppressed' }
  }

  const slot = await claimSendSlot(supabase, input)
  if (slot.kind === 'skip') return { status: 'skipped_duplicate', reason: slot.reason }

  let messageId: string
  try {
    messageId = await resendSend(
      input.toEmail,
      input.subject,
      input.html,
      listUnsubscribeHeaders(input.userId),
    )
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err)
    // The row STAYS, now marked failed rather than looking like a completed
    // step. Deleting it instead would re-send on the next run whenever Resend
    // had in fact accepted the message before the request fell over.
    await stampOutcome(supabase, slot.eventId, {
      status: 'failed',
      failure_reason: reason.slice(0, 500),
    })
    return { status: 'failed', reason }
  }

  const { error: stampError } = await stampOutcome(supabase, slot.eventId, {
    status: 'sent',
    resend_message_id: messageId,
    failure_reason: null,
  })

  if (stampError) {
    // Resend accepted the message; only our bookkeeping failed. Recording this
    // as a failure would be a lie that causes a double-send, so it gets its own
    // terminal state. If this second write also fails the row stays 'pending',
    // which is likewise never retried.
    const reason = stampError instanceof Error ? stampError.message : JSON.stringify(stampError)
    console.error('sendSequenceEmail: sent but could not record the message id', stampError)
    await stampOutcome(supabase, slot.eventId, {
      status: 'send_id_unrecorded',
      failure_reason: `sent, id not recorded: ${String(reason).slice(0, 400)}`,
    })
  }

  return { status: 'sent', messageId }
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
