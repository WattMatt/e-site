import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { billingService } from '@esite/shared'
import { addBillingPeriod } from '@/lib/paystack/billing-period'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

/**
 * THE SINGLE PAYSTACK INGRESS.
 *
 * Paystack accepts exactly one webhook URL per mode, and the go-live runbook
 * (docs/paystack-go-live-roadmap.md §3C step 8) registers THIS route. The edge
 * function `paystack-webhook` used to carry a divergent second implementation
 * and is now a 410 stub so a mis-pasted URL fails loudly instead of silently
 * granting nothing. Anything that must happen on a Paystack event has to live
 * here.
 *
 * NOT ported from the edge function, deliberately:
 *   • `transfer.*` — nothing in the repo initiates a Paystack transfer or
 *     writes marketplace.commission_payouts, and the runbook does not even
 *     subscribe those events.
 *   • the `metadata.order_id` marketplace branch — owned by the marketplace
 *     payment work; see the report accompanying this change. Marketplace
 *     payments MUST NOT go live until that branch exists here.
 */

// ── Error policy ────────────────────────────────────────────────────────────
//
// A Paystack 200 is a promise that the event was handled. Every write below
// therefore either succeeds or returns 500, so Paystack retries — the only
// recovery mechanism that exists, since there is no reconciliation cron.
// The single exception is a unique violation on a business-identity index
// (see DUPLICATE_PURCHASE_CONSTRAINTS): a retry can never satisfy it, so
// returning 500 would be a poison pill. Those are escalated to a human.

/**
 * Unique indexes that mean "this org/user already holds the thing that was
 * just paid for". Hitting one is a DOUBLE CHARGE, not a duplicate delivery —
 * duplicate deliveries collide on `paystack_reference`, which is the upsert's
 * conflict target and therefore never raises at all.
 */
const DUPLICATE_PURCHASE_CONSTRAINTS = [
  'org_feature_unlocks_organisation_id_feature_key_key',
  'uq_org_feature_seats_assignment',
]

type PgError = { code?: string; message?: string; details?: string } | null

function isDuplicatePurchase(err: PgError): boolean {
  if (!err || err.code !== '23505') return false
  const text = `${err.message ?? ''} ${err.details ?? ''}`
  return DUPLICATE_PURCHASE_CONSTRAINTS.some((c) => text.includes(c))
}

function storageFailure(label: string, err: unknown) {
  console.error(`Paystack webhook ${label} failed:`, err)
  return NextResponse.json({ error: `${label} failed` }, { status: 500 })
}

const ok = () => NextResponse.json({ received: true })

// ── Shared helpers ──────────────────────────────────────────────────────────

type Client = Awaited<ReturnType<typeof createServiceClient>>

interface SubscriptionFailureRow {
  id: string
  payment_failure_count: number | null
  last_payment_failure_at: string | null
}

/**
 * Record a payment failure against a subscription so the daily
 * payment-recovery cron escalates it. `last_payment_failure_at` is set only on
 * the first failure of a cycle — kept stable so the recovery timeline advances
 * instead of resetting on every Paystack retry. A duplicate webhook delivery
 * only inflates the counter, which the cron does not use by magnitude.
 */
async function recordPaymentFailure(supabase: Client, sub: SubscriptionFailureRow): Promise<void> {
  const { error } = await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .update({
      payment_failure_count: (sub.payment_failure_count ?? 0) + 1,
      last_payment_failure_at: sub.last_payment_failure_at ?? new Date().toISOString(),
      status: 'past_due',
    })
    .eq('id', sub.id)
  if (error) console.error('Webhook recordPaymentFailure error:', error)
}

/** Look up a subscription's failure-tracking columns by an arbitrary match. */
async function findSubscription(
  supabase: Client,
  column: string,
  value: string,
): Promise<SubscriptionFailureRow | null> {
  const { data } = await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .select('id, payment_failure_count, last_payment_failure_at')
    .eq(column, value)
    .maybeSingle()
  return (data as SubscriptionFailureRow | null) ?? null
}

/**
 * Durable payment-event log. The live Terms of Service already promises one
 * ("flagged in our payment-event log", legal/terms/page.tsx) and no table
 * existed. Idempotent on (event_type, paystack_reference).
 */
async function logPaymentEvent(
  supabase: Client,
  params: { eventType: string; reference?: string; organisationId?: string | null; userId?: string | null; amountKobo?: number | null; payload: unknown },
): Promise<{ error: PgError }> {
  if (!params.reference) {
    console.warn(`Paystack webhook ${params.eventType}: no reference, not logging`)
    return { error: null }
  }
  const { error } = await (supabase as any)
    .schema('billing')
    .from('payment_events')
    .upsert(
      {
        event_type: params.eventType,
        paystack_reference: params.reference,
        organisation_id: params.organisationId ?? null,
        user_id: params.userId ?? null,
        amount_kobo: params.amountKobo ?? null,
        payload: params.payload,
      },
      { onConflict: 'event_type,paystack_reference', ignoreDuplicates: false },
    )
  return { error: (error as PgError) ?? null }
}

/**
 * Raise a notification to every owner/admin of an org. Used where money has
 * moved but the automated path cannot finish the job — a second charge for a
 * feature the org already holds, a refund, a dispute. These must reach a
 * person, not a log line.
 */
async function notifyOrgAdmins(
  supabase: Client,
  orgId: string,
  note: { type: string; title: string; body: string; actionUrl?: string; data?: Record<string, unknown> },
): Promise<{ error: PgError }> {
  const { data: members, error: memberErr } = await (supabase as any)
    .from('user_organisations')
    .select('user_id')
    .eq('organisation_id', orgId)
    .eq('is_active', true)
    .in('role', ['owner', 'admin'])
  if (memberErr) return { error: memberErr as PgError }

  const rows = ((members as Array<{ user_id: string }> | null) ?? []).map((m) => ({
    user_id: m.user_id,
    organisation_id: orgId,
    type: note.type,
    title: note.title,
    body: note.body,
    action_url: note.actionUrl ?? '/settings/billing',
    data: note.data ?? {},
  }))
  if (rows.length === 0) {
    console.warn(`Paystack webhook: no owner/admin to notify for org ${orgId} (${note.type})`)
    return { error: null }
  }
  const { error } = await (supabase as any).from('notifications').insert(rows)
  return { error: (error as PgError) ?? null }
}

/** Resolve a user's primary (oldest active) organisation. */
async function resolveUserOrg(supabase: Client, userId: string): Promise<string | null> {
  const { data } = await (supabase as any)
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', userId)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  return (data as { organisation_id?: string } | null)?.organisation_id ?? null
}

// ─────────────────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Fail closed: a missing secret must never let an unsigned request through.
  if (!PAYSTACK_SECRET) {
    console.error('Paystack webhook: PAYSTACK_SECRET_KEY is not configured')
    return NextResponse.json({ error: 'Webhook not configured' }, { status: 500 })
  }

  const signature = req.headers.get('x-paystack-signature')
  const rawBody = await req.text()

  // Constant-time signature check. Compare buffer byte-lengths first so a
  // malformed header can never make timingSafeEqual throw.
  const expected = Buffer.from(
    createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex'),
  )
  const provided = signature ? Buffer.from(signature) : Buffer.alloc(0)
  if (provided.length !== expected.length || !timingSafeEqual(expected, provided)) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const supabase = await createServiceClient()

  if (event.event === 'charge.success') {
    const data = event.data
    // Paystack sends literal `"metadata": 0` on subscription renewals — not an
    // object, not absent. Normalise before any property read.
    const metadata: Record<string, any> =
      data.metadata && typeof data.metadata === 'object' ? data.metadata : {}

    // Branch A0: per-seat feature purchase — one-time charge that assigns a
    // discrete feature seat to a specific user within an org.
    // Discriminated by metadata.type set in /api/paystack/feature-seat.
    if (metadata.type === 'feature_seat' && metadata.org_id && metadata.user_id && metadata.feature_key) {
      const orgId = metadata.org_id as string
      const featureKey = metadata.feature_key as string
      const amountKobo = (metadata.amount_kobo as number | undefined) ?? data.amount

      // Idempotent on paystack_reference — duplicate webhook deliveries no-op.
      const { error: seatErr } = await (supabase as any)
        .schema('billing')
        .from('org_feature_seats')
        .upsert({
          organisation_id:    orgId,
          feature_key:        featureKey,
          assigned_user_id:   metadata.user_id,
          paystack_reference: data.reference,
          amount_paid_kobo:   amountKobo,
          assigned_at:        new Date().toISOString(),
        }, { onConflict: 'paystack_reference', ignoreDuplicates: true })

      const duplicate = isDuplicatePurchase(seatErr as PgError)
      if (seatErr && !duplicate) return storageFailure('feature_seat grant', seatErr)

      if (duplicate) {
        const notified = await notifyOrgAdmins(supabase, orgId, {
          type: 'billing_duplicate_charge',
          title: 'Duplicate payment received',
          body:
            `A second payment was taken for the ${featureKey} seat for user ${metadata.user_id}, ` +
            `which this organisation already holds. Reference ${data.reference}. A refund is required.`,
          data: { reference: data.reference, feature_key: featureKey, user_id: metadata.user_id, amount_kobo: amountKobo },
        })
        if (notified.error) return storageFailure('duplicate-charge notification', notified.error)
      }

      // Audit trail in billing.invoices (also idempotent on paystack_reference).
      try {
        await billingService.recordInvoice(supabase as any, orgId, {
          paystackReference: data.reference,
          amountKobo,
          status:      'paid',
          description: duplicate
            ? `DUPLICATE PURCHASE — seat: ${featureKey} → ${metadata.user_id} (already held; refund required)`
            : `Seat: ${featureKey} → ${metadata.user_id}`,
          paidAt:      new Date().toISOString(),
        })
      } catch (err) {
        return storageFailure('feature_seat invoice', err)
      }

      return ok()
    }

    // Branch A: paid add-on feature unlock — one-time charge that grants the
    // org lifetime access to a discrete module (inspections, JBCC, …).
    // Discriminated by metadata.type set in /api/paystack/feature-unlock.
    if (metadata.type === 'feature_unlock' && metadata.org_id && metadata.feature_key) {
      const orgId      = metadata.org_id as string
      const featureKey = metadata.feature_key as string
      const amountKobo = (metadata.amount_kobo as number | undefined) ?? data.amount

      // Idempotent on paystack_reference — duplicate webhook deliveries no-op.
      const { error: unlockErr } = await (supabase as any)
        .schema('billing')
        .from('org_feature_unlocks')
        .upsert(
          {
            organisation_id:    orgId,
            feature_key:        featureKey,
            paystack_reference: data.reference,
            amount_paid_kobo:   amountKobo,
          },
          { onConflict: 'paystack_reference', ignoreDuplicates: true },
        )

      // A 23505 here is NOT a duplicate delivery — those collide on
      // paystack_reference, which is the conflict target and never raises.
      // It is a SECOND, distinct reference for a feature the org already
      // holds: the customer has been charged twice (finding #17).
      const duplicate = isDuplicatePurchase(unlockErr as PgError)
      if (unlockErr && !duplicate) return storageFailure('feature_unlock grant', unlockErr)

      if (duplicate) {
        const notified = await notifyOrgAdmins(supabase, orgId, {
          type: 'billing_duplicate_charge',
          title: 'Duplicate payment received',
          body:
            `A second payment was taken for the ${featureKey} module, which this organisation ` +
            `already has unlocked. Reference ${data.reference}. A refund is required.`,
          data: { reference: data.reference, feature_key: featureKey, amount_kobo: amountKobo },
        })
        if (notified.error) return storageFailure('duplicate-charge notification', notified.error)
      }

      // Audit trail in billing.invoices (also idempotent on paystack_reference).
      try {
        await billingService.recordInvoice(supabase as any, orgId, {
          paystackReference: data.reference,
          amountKobo,
          status:            'paid',
          description:       duplicate
            ? `DUPLICATE PURCHASE — feature unlock: ${featureKey} (already unlocked; refund required)`
            : `Feature unlock: ${featureKey}`,
          paidAt:            new Date().toISOString(),
        })
      } catch (err) {
        return storageFailure('feature_unlock invoice', err)
      }

      return ok()
    }

    // Branch A2: per-user MV subscription charge (paywall, Phase 7). Discrete
    // from the org subscription path below — keyed on metadata.user_id, written
    // to billing.user_mv_subscriptions. Grants on the initial charge AND each
    // annual renewal. Idempotent on last_event_id so a duplicate delivery (or
    // the callback recording the same charge) is a clean no-op.
    if (metadata.type === 'mv_subscription' && metadata.user_id) {
      const userId = metadata.user_id as string
      const eventId = (event.id as string | undefined) ?? data.reference
      const amountKobo = (metadata.amount_kobo as number | undefined) ?? data.amount

      const { data: existing } = await (supabase as any)
        .schema('billing')
        .from('user_mv_subscriptions')
        .select('last_event_id')
        .eq('user_id', userId)
        .maybeSingle()

      // Already processed this exact event — no-op.
      if (existing?.last_event_id && existing.last_event_id === eventId) {
        return ok()
      }

      // charge.success carries no subscription next-payment date, so default the
      // access window to one year out. invoice.update on each renewal keeps
      // current_period_end fresh from the authoritative next_payment_date.
      const periodEnd = new Date()
      periodEnd.setFullYear(periodEnd.getFullYear() + 1)

      const { error: mvErr } = await (supabase as any)
        .schema('billing')
        .from('user_mv_subscriptions')
        .upsert(
          {
            user_id: userId,
            status: 'active',
            current_period_end: periodEnd.toISOString(),
            paystack_customer_code: data.customer?.customer_code,
            paystack_subscription_code:
              data.subscription?.subscription_code ?? data.plan_object?.subscription_code ?? undefined,
            last_event_id: eventId,
          },
          { onConflict: 'user_id', ignoreDuplicates: false },
        )
      if (mvErr) return storageFailure('mv_subscription grant', mvErr)

      // billing.invoices.organisation_id is NOT NULL and mv_subscription
      // metadata carries only user_id, so resolve the buyer's org. Without an
      // invoice row there is ZERO record that R2,000 was taken.
      const orgId = await resolveUserOrg(supabase, userId)
      if (orgId) {
        try {
          await billingService.recordInvoice(supabase as any, orgId, {
            paystackReference: data.reference,
            amountKobo,
            status: 'paid',
            description: `MV protection subscription (annual) — user ${userId}`,
            paidAt: new Date().toISOString(),
          })
        } catch (err) {
          return storageFailure('mv_subscription invoice', err)
        }
      } else {
        // No org to invoice against — fall back to the payment-event log so the
        // money is still on record somewhere.
        const logged = await logPaymentEvent(supabase, {
          eventType: 'charge.success.mv_subscription',
          reference: data.reference,
          userId,
          amountKobo,
          payload: { note: 'no organisation resolved for MV subscriber; no invoice row written' },
        })
        if (logged.error) return storageFailure('mv_subscription payment-event log', logged.error)
      }

      return ok()
    }

    // Branch B: subscription charge (recurring or one-off fallback).
    const { org_id, tier, period, amount_kobo, plan_code, mode } = metadata
    if (org_id && tier) {
      const billingPeriod = period ?? 'monthly'
      try {
        await billingService.upsertSubscription(supabase as any, org_id, {
          tier,
          billingPeriod,
          status: 'active',
          paystackCustomerCode: data.customer?.customer_code,
          paystackPlanCode: plan_code ?? data.plan_object?.plan_code ?? data.plan ?? undefined,
          amountKobo: amount_kobo ?? data.amount,
          // Finding #19: without this the column stays NULL and the nightly
          // downgrade job can never see the row.
          nextBillingDate: addBillingPeriod(data.paid_at as string | undefined, billingPeriod),
        })
      } catch (err) {
        return storageFailure('subscription upsert', err)
      }

      // A successful charge clears any open failure cycle so the recovery cron
      // stops chasing a customer who has now paid.
      const { error: resetError } = await (supabase as any)
        .schema('billing')
        .from('subscriptions')
        .update({ payment_failure_count: 0, last_payment_failure_at: null })
        .eq('organisation_id', org_id)
        .gt('payment_failure_count', 0)
      if (resetError) return storageFailure('failure-counter reset', resetError)

      // Idempotent on paystack_reference — safe against duplicate deliveries
      // and the callback recording the same first charge.
      try {
        await billingService.recordInvoice(supabase as any, org_id, {
          paystackReference: data.reference,
          amountKobo: data.amount,
          status: 'paid',
          description: `${tier} plan charge${mode === 'recurring' ? ' (recurring)' : ''}`,
          paidAt: new Date().toISOString(),
        })
      } catch (err) {
        return storageFailure('subscription invoice', err)
      }

      return ok()
    }

    // Branch C: a RENEWAL charge carries no initialize-time metadata at all
    // (Paystack's own subscription docs show `"metadata": 0`). Dropping it here
    // meant no invoice row for any renewal, ever. Match on the customer/plan
    // codes the payload does carry. We never invent a tier — an unmatched
    // renewal is logged and acknowledged, not guessed at.
    const customerCode = data.customer?.customer_code as string | undefined
    const subCode = data.subscription?.subscription_code as string | undefined
    const renewalPlanCode = (data.plan?.plan_code ?? data.plan_object?.plan_code) as string | undefined

    const renewalSub = (await (async () => {
      for (const [col, val] of [
        ['paystack_subscription_code', subCode],
        ['paystack_customer_code', customerCode],
        ['paystack_plan_code', renewalPlanCode],
      ] as const) {
        if (!val) continue
        const { data: row } = await (supabase as any)
          .schema('billing')
          .from('subscriptions')
          .select('id, organisation_id, tier, billing_period')
          .eq(col, val)
          .maybeSingle()
        if (row) return row as { id: string; organisation_id: string; tier: string; billing_period: string }
      }
      return null
    })())

    if (!renewalSub) {
      console.warn(`Webhook charge.success ref=${data.reference}: no metadata and no subscription matched`)
      return ok()
    }

    const { error: renewalReset } = await (supabase as any)
      .schema('billing')
      .from('subscriptions')
      .update({ status: 'active', payment_failure_count: 0, last_payment_failure_at: null })
      .eq('id', renewalSub.id)
    if (renewalReset) return storageFailure('renewal failure-counter reset', renewalReset)

    try {
      await billingService.recordInvoice(supabase as any, renewalSub.organisation_id, {
        paystackReference: data.reference,
        amountKobo: data.amount,
        status: 'paid',
        description: `${renewalSub.tier} plan charge (recurring)`,
        paidAt: (data.paid_at as string | undefined) ?? new Date().toISOString(),
      })
    } catch (err) {
      return storageFailure('renewal invoice', err)
    }

    return ok()
  }

  // ── invoice.create / invoice.update ───────────────────────────────────────
  //
  // invoice.update is the ONLY event that can clear projects.status =
  // 'payment_paused', which the daily payment-recovery cron sets. Before this
  // was ported from the edge function, a customer whose card failed for 14
  // days had every project write-locked by six RLS policies, paid, and stayed
  // locked forever.
  if (event.event === 'invoice.create') {
    // Nothing to do — wait for invoice.update to confirm payment. Declared
    // explicitly so an unhandled-event log line is never mistaken for a bug.
    return ok()
  }

  if (event.event === 'invoice.update') {
    const inv = event.data
    const reference = inv.transaction?.reference as string | undefined
    const subscriptionCode = inv.subscription?.subscription_code as string | undefined
    const nextPaymentDate = inv.subscription?.next_payment_date as string | undefined
    const paid = inv.status === 'success'
    const amountKobo = (inv.amount as number | undefined) ?? 0

    if (!subscriptionCode) {
      console.warn('Webhook invoice.update: no subscription_code, skipping')
      return ok()
    }

    const { data: sub } = await (supabase as any)
      .schema('billing')
      .from('subscriptions')
      .select('organisation_id')
      .eq('paystack_subscription_code', subscriptionCode)
      .maybeSingle()

    if (sub) {
      const orgId = (sub as { organisation_id: string }).organisation_id

      // Idempotent upsert, NOT a raw insert: billing.invoices has
      // UNIQUE(paystack_reference), so a re-delivered invoice.update would
      // 500 forever on an insert.
      try {
        await billingService.recordInvoice(supabase as any, orgId, {
          paystackReference: reference ?? `sub-${subscriptionCode}-${inv.period_start ?? inv.created_at ?? ''}`,
          amountKobo,
          status: paid ? 'paid' : 'failed',
          description: 'Subscription renewal',
          paidAt: paid ? ((inv.paid_at as string | undefined) ?? new Date().toISOString()) : undefined,
        })
      } catch (err) {
        return storageFailure('renewal invoice', err)
      }

      const patch: Record<string, unknown> = paid
        ? { status: 'active', payment_failure_count: 0, last_payment_failure_at: null }
        : { status: 'past_due' }
      if (paid && nextPaymentDate) patch.next_billing_date = nextPaymentDate.slice(0, 10)

      const { error: subErr } = await (supabase as any)
        .schema('billing')
        .from('subscriptions')
        .update(patch)
        .eq('paystack_subscription_code', subscriptionCode)
      if (subErr) return storageFailure('renewal subscription update', subErr)

      if (paid) {
        // Restore any projects the recovery flow paused. Scoped to this org and
        // to payment_paused rows only — never a blanket un-pause.
        const { error: restoreErr } = await (supabase as any)
          .schema('projects')
          .from('projects')
          .update({ status: 'active' })
          .eq('organisation_id', orgId)
          .eq('status', 'payment_paused')
        if (restoreErr) return storageFailure('project un-pause', restoreErr)
      }

      return ok()
    }

    // Not an org subscription — try the per-user MV subscription. Without this
    // current_period_end never advances and user_has_mv_access (which requires
    // current_period_end > NOW()) revokes a paying subscriber on their
    // anniversary while Paystack keeps billing them.
    const { data: mv } = await (supabase as any)
      .schema('billing')
      .from('user_mv_subscriptions')
      .select('id')
      .eq('paystack_subscription_code', subscriptionCode)
      .maybeSingle()

    if (mv) {
      const mvPatch: Record<string, unknown> = paid ? { status: 'active' } : { status: 'past_due' }
      if (paid && nextPaymentDate) mvPatch.current_period_end = nextPaymentDate
      const { error: mvErr } = await (supabase as any)
        .schema('billing')
        .from('user_mv_subscriptions')
        .update(mvPatch)
        .eq('paystack_subscription_code', subscriptionCode)
      if (mvErr) return storageFailure('MV renewal update', mvErr)
      return ok()
    }

    console.warn(`Webhook invoice.update: no subscription matched code=${subscriptionCode}`)
    return ok()
  }

  // ── Refunds (finding #16) ─────────────────────────────────────────────────
  //
  // The first refund is already scheduled: the go-live runbook instructs
  // refunding the live smoke-test charge from the dashboard.
  // billing.org_feature_unlocks had NO revoke path anywhere in the monorepo,
  // so a refunded R1,999 JBCC unlock was permanent access.
  if (event.event.startsWith('refund.')) {
    const data = event.data ?? {}
    const reference =
      (data.transaction_reference as string | undefined) ??
      (data.transaction?.reference as string | undefined) ??
      (data.reference as string | undefined)
    const amountKobo = (data.amount as number | undefined) ?? null
    const processed = event.event === 'refund.processed'

    const logged = await logPaymentEvent(supabase, {
      eventType: event.event,
      reference,
      amountKobo,
      payload: data,
    })
    if (logged.error) return storageFailure('refund payment-event log', logged.error)

    // refund.pending / refund.failed are informational — access is only taken
    // away once the money has actually gone back.
    if (!processed || !reference) return ok()

    const { error: invErr } = await (supabase as any)
      .schema('billing')
      .from('invoices')
      .update({ status: 'refunded' })
      .eq('paystack_reference', reference)
    if (invErr) return storageFailure('refund invoice update', invErr)

    // Marketplace side. Both values are already legal in their CHECKs.
    const { error: orderErr } = await (supabase as any)
      .schema('marketplace')
      .from('orders')
      .update({ payment_status: 'refunded' })
      .eq('paystack_reference', reference)
    if (orderErr) return storageFailure('refund order update', orderErr)

    const { error: commErr } = await (supabase as any)
      .schema('marketplace')
      .from('commission_records')
      .update({ payout_status: 'refunded' })
      .eq('paystack_reference', reference)
    if (commErr) return storageFailure('refund commission update', commErr)

    // Revoke the entitlement the refunded money bought. `revoked_at` is read by
    // public.has_feature (migration 00190), so this genuinely removes access
    // rather than only recording an intention to.
    const { data: unlock } = await (supabase as any)
      .schema('billing')
      .from('org_feature_unlocks')
      .select('id, organisation_id, feature_key')
      .eq('paystack_reference', reference)
      .maybeSingle()

    if (unlock) {
      const u = unlock as { id: string; organisation_id: string; feature_key: string }
      const { error: revokeErr } = await (supabase as any)
        .schema('billing')
        .from('org_feature_unlocks')
        .update({
          revoked_at: new Date().toISOString(),
          revoked_reason: `Refunded via Paystack (${event.event}, ref ${reference})`,
        })
        .eq('id', u.id)
      if (revokeErr) return storageFailure('feature-unlock revoke', revokeErr)

      const notified = await notifyOrgAdmins(supabase, u.organisation_id, {
        type: 'billing_refund_processed',
        title: 'Refund processed — module access removed',
        body: `The ${u.feature_key} module unlock was refunded (reference ${reference}) and access has been removed.`,
        data: { reference, feature_key: u.feature_key },
      })
      if (notified.error) return storageFailure('refund notification', notified.error)
    }

    // Seats are revoked by deleting the assignment — has_feature_seat has no
    // revoked_at column and the row carries no other state worth keeping.
    const { error: seatRevokeErr } = await (supabase as any)
      .schema('billing')
      .from('org_feature_seats')
      .update({ assigned_user_id: null, notes: `Refunded via Paystack (ref ${reference})` })
      .eq('paystack_reference', reference)
    if (seatRevokeErr) return storageFailure('feature-seat revoke', seatRevokeErr)

    return ok()
  }

  // ── Disputes / chargebacks (finding #16) ──────────────────────────────────
  //
  // NOTE: billing.invoices.invoices_status_check permits
  // pending / pending_eft / paid / failed / refunded / voided — 'disputed'
  // raises 23514. Disputes are therefore recorded in billing.payment_events
  // and escalated to a human, never written to the invoice status.
  if (event.event.startsWith('charge.dispute.')) {
    const data = event.data ?? {}
    const reference =
      (data.transaction?.reference as string | undefined) ??
      (data.transaction_reference as string | undefined)
    const amountKobo =
      (data.transaction?.amount as number | undefined) ?? (data.amount as number | undefined) ?? null

    const logged = await logPaymentEvent(supabase, {
      eventType: event.event,
      reference,
      amountKobo,
      payload: data,
    })
    if (logged.error) return storageFailure('dispute payment-event log', logged.error)

    if (!reference) return ok()

    const { data: invoice } = await (supabase as any)
      .schema('billing')
      .from('invoices')
      .select('organisation_id')
      .eq('paystack_reference', reference)
      .maybeSingle()

    const orgId = (invoice as { organisation_id?: string } | null)?.organisation_id
    if (orgId) {
      const notified = await notifyOrgAdmins(supabase, orgId, {
        type: 'billing_dispute_opened',
        title: 'Payment dispute opened',
        body: `A dispute was raised against payment reference ${reference} (${event.event}). Resolve it in the Paystack dashboard.`,
        data: { reference, event: event.event },
      })
      if (notified.error) return storageFailure('dispute notification', notified.error)
    }

    return ok()
  }

  // A failed charge — the initial checkout charge or a recurring renewal —
  // opens the payment-failure cycle the recovery cron escalates.
  if (event.event === 'charge.failed') {
    const data = event.data
    const orgId = data.metadata?.org_id as string | undefined
    const customerCode = data.customer?.customer_code as string | undefined
    const sub =
      (orgId ? await findSubscription(supabase, 'organisation_id', orgId) : null) ??
      (customerCode ? await findSubscription(supabase, 'paystack_customer_code', customerCode) : null)
    if (sub) await recordPaymentFailure(supabase, sub)
    else console.warn('Webhook charge.failed: no subscription matched')
  }

  // Path B: subscription.create fires once per recurring subscription, ~5–30s
  // after the first charge.success. Carries the authoritative subscription_code
  // and next_payment_date the synchronous callback could not capture.
  // We match the existing row by (customer_code + plan_code) and fill them in.
  if (event.event === 'subscription.create') {
    const sub = event.data
    const customerCode = sub.customer?.customer_code
    const planCode = sub.plan?.plan_code
    if (customerCode && planCode) {
      const { error } = await supabase
        .schema('billing')
        .from('subscriptions')
        .update({
          paystack_subscription_code: sub.subscription_code,
          next_billing_date: sub.next_payment_date ?? null,
          status: 'active',
        })
        .eq('paystack_customer_code', customerCode)
        .eq('paystack_plan_code', planCode)
      if (error) console.error('Webhook subscription.create error:', error)
    }
  }

  if (event.event === 'subscription.disable' || event.event === 'subscription.not_renew') {
    const sub = event.data
    // Find org by paystack_subscription_code and mark as cancelled
    const { error } = await supabase
      .schema('billing')
      .from('subscriptions')
      .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
      .eq('paystack_subscription_code', sub.subscription_code)
    if (error) console.error('Webhook cancel error:', error)

    // Additionally expire a per-user MV subscription (Phase 7) bound to this
    // Paystack subscription. No-op when the disabled subscription is an org one.
    const { error: mvCancelErr } = await (supabase as any)
      .schema('billing')
      .from('user_mv_subscriptions')
      .update({ status: 'expired' })
      .eq('paystack_subscription_code', sub.subscription_code)
    if (mvCancelErr) console.error('Webhook mv cancel error:', mvCancelErr)
  }

  // A subscription renewal invoice failed — the primary Paystack signal for a
  // failed recurring charge. Open/extend the recovery cycle.
  if (event.event === 'invoice.payment_failed') {
    const inv = event.data
    const subCode = inv.subscription?.subscription_code as string | undefined
    if (subCode) {
      const sub = await findSubscription(supabase, 'paystack_subscription_code', subCode)
      if (sub) await recordPaymentFailure(supabase, sub)
    }
  }

  return ok()
}
