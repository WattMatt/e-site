import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { readSvixHeaders, verifySvixSignature } from '@/lib/webhooks/svix-signature'
import { mapResendEvent, suppressionFor, sequenceTimestampFor } from '@/lib/webhooks/resend-events'

/**
 * Resend delivery-event webhook.
 *
 * Closes the measurement gap 00030_email_sequences.sql:24-25 left open: every
 * opened_at and clicked_at in production is NULL across 246 sends because the
 * "Phase 2" webhook was never built. Q1's outcome ships over this channel, so
 * it has to be measurable before it is designed on (§05 :173).
 *
 * The Svix signature is the ONLY authenticator — this handler sits outside
 * every session gate, so it is checked before the body is parsed or anything
 * is written. Note that middleware.ts must also let the path through
 * (SIGNED_WEBHOOK_PATHS); without that the request is 307'd to /login and
 * Svix records a delivery failure that looks like a Resend problem.
 *
 * Non-2xx makes Svix retry and eventually disable the endpoint, so an event
 * type we do not handle is acknowledged with a 200, and only a genuine storage
 * failure returns a 500 (where a retry is exactly what we want).
 */

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest) {
  // Read per request, not at module scope: a warm lambda that started before
  // RESEND_WEBHOOK_SECRET was set would otherwise keep serving 500s after it
  // is set, and the test would need vi.resetModules() to reach this branch.
  const webhookSecret = process.env.RESEND_WEBHOOK_SECRET

  // Fail closed: a missing secret must never let an unsigned request through.
  if (!webhookSecret) {
    console.error('Resend webhook: RESEND_WEBHOOK_SECRET is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const headers = readSvixHeaders((name) => req.headers.get(name))
  const rawBody = await req.text()
  if (!headers || !verifySvixSignature({ secret: webhookSecret, body: rawBody, headers })) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  let parsed: unknown
  try {
    parsed = JSON.parse(rawBody)
  } catch {
    // Signed but unparseable: acknowledge, do not invite a retry loop.
    console.warn('Resend webhook: signed body was not JSON')
    return NextResponse.json({ ignored: true })
  }

  const row = mapResendEvent(headers.id, parsed)
  if (!row) return NextResponse.json({ ignored: true })

  const supabase = createServiceClient() as any

  // Plain insert, not upsert: PostgREST only emits ON CONFLICT when
  // `Prefer: resolution=merge-duplicates` arrives as a header, and this
  // repository has twice shipped an upsert that reported no error and wrote
  // nothing. webhook_id is UNIQUE, so a Svix retry lands 23505 — which is
  // success, not failure.
  const { error: insertError } = await supabase.from('email_events').insert(row)
  const duplicate = insertError?.code === '23505'
  if (insertError && !duplicate) {
    console.error('Resend webhook: email_events insert failed', insertError)
    return NextResponse.json({ error: 'store failed' }, { status: 500 })
  }
  // Fall through on 23505 rather than returning here. The suppression upsert
  // and the stamp are both idempotent (upsert on the primary key; the stamp is
  // filtered `.is(column, null)`), so re-running them on a retry costs nothing
  // — and the retry the suppression 500 below asks for arrives with the SAME
  // svix-id, so it lands here. An early return would make that retry incapable
  // of doing the one thing it was requested for: the suppression would be lost
  // permanently while Svix recorded the delivery as succeeded.

  const suppression = suppressionFor(row)
  if (suppression) {
    const { error } = await supabase
      .from('email_suppressions')
      .upsert(suppression, { onConflict: 'email_address' })
    if (error) {
      console.error('Resend webhook: email_suppressions upsert failed', error)
      return NextResponse.json({ error: 'suppress failed' }, { status: 500 })
    }
  }

  // The stamp is the write this whole item exists to make, so its outcome goes
  // in the response body rather than only into a log line nobody reads.
  //
  // .is(column, null) so the FIRST open wins — a message opened five times
  // keeps the timestamp of the open that mattered.
  //
  // A stamp failure does NOT 500, and — since the 23505 fall-through above — it
  // is a deliberate choice rather than a fact about retries. The stamp is
  // measurement; the suppression is a control. A persistent stamp failure (a
  // 42501, say) would 500 every delivery, and Svix disables an endpoint that
  // keeps failing — which would take the suppressions down with it. The
  // stamp_error flag in the body is the signal instead.
  let stamped = 0
  let stampError = false
  const stamp = sequenceTimestampFor(row)
  if (stamp && row.resend_message_id) {
    const { data, error } = await supabase
      .from('email_sequence_events')
      .update({ [stamp.column]: stamp.value })
      .eq('resend_message_id', row.resend_message_id)
      .is(stamp.column, null)
      .select('id')
    if (error) {
      console.error('Resend webhook: sequence stamp failed', error)
      stampError = true
    } else {
      stamped = data?.length ?? 0
    }
  }

  // `duplicate` is carried into the body, and `stamped` is reported on a
  // duplicate too: Task 7's production curl reads this body, and a replay that
  // answered `stamped: undefined` would read as a broken stamp.
  return NextResponse.json({
    received: true,
    ...(duplicate ? { duplicate: true } : {}),
    ...(stampError ? { stamped: 0, stamp_error: true } : { stamped }),
  })
}
