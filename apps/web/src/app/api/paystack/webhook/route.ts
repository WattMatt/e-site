import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { billingService, FEATURE_PRICES } from '@esite/shared'
import { addBillingPeriod } from '@/lib/paystack/billing-period'
import {
  ORG_ADDON_METADATA_TYPE,
  ORG_ADDON_CHARGE_EVENT,
  ORG_ADDON_DUPLICATE_EVENT,
  ORG_ADDON_UNMATCHED_EVENT,
  ORG_ADDON_PRIOR_PERIOD_REFUND_EVENT,
  nextAddonPeriodEnd,
  planCodeOf,
  solarPlanCode,
  subscriptionCodeOf,
} from '@/lib/paystack/org-addon'

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

// ── Org add-on subscriptions (Solar — billing.org_addon_subscriptions, 00208) ─
//
// THIS ROUTE IS THE ONLY WRITER of billing.org_addon_subscriptions (service
// client; the table has SELECT for org owner/admin and no write policy).
// /api/paystack/solar-subscribe writes nothing — the first successful charge
// INSERTS the row. Idempotency: `last_event_id` holds the Paystack charge
// REFERENCE of the last charge applied — unique per charge and always present.
// (MV keys on `event.id ?? reference`; Paystack documents no top-level event
// id, so that is the reference in practice anyway.)

interface AddonRow {
  id: string
  organisation_id: string
  status: string
  current_period_end: string | null
  last_event_id: string | null
  paystack_subscription_code: string | null
}

const ADDON_COLUMNS =
  'id, organisation_id, status, current_period_end, last_event_id, paystack_subscription_code'

function addonTable(supabase: Client) {
  return (supabase as any).schema('billing').from('org_addon_subscriptions')
}

/**
 * Is the Paystack subscription the row is bound to still LIVE? Only then is a
 * different subscription "foreign" (a duplicate to escalate). Once the bound
 * one has ended — cancelled, refunded, or non_renewing past its period — a
 * Solar-plan event from another subscription of the same customer is the
 * org's surviving subscription: new money that restores Solar (D-02) and may
 * take over the binding.
 */
function boundSubscriptionLive(row: AddonRow, at: number = Date.now()): boolean {
  if (row.status === 'active' || row.status === 'past_due') return true
  if (row.status !== 'non_renewing') return false
  const end = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN
  return Number.isFinite(end) && end > at
}

/**
 * Find the org add-on row a Paystack event belongs to: by subscription code,
 * else by customer code — but ONLY when the event's plan is the Solar plan, so
 * a tier-plan event from the same payer is never mistaken for Solar.
 * `solarPlan` tells the caller the event IS a Solar-plan event even when no
 * row matched, so it can refuse to let the event fall into a tier branch.
 *
 * `foreign` is set when the row was found by CUSTOMER code but is already
 * bound to a DIFFERENT Paystack subscription than the one the event names —
 * a duplicate purchase's second subscription, or an old subscription still
 * live after a resubscribe. State-changing callers must ignore such a row
 * (a disable of the duplicate must not end the live one; its create must not
 * steal the binding); the renewal branch books its charge as a duplicate.
 *
 * More than one row for one customer code (one person paying for two orgs)
 * is ambiguous: no row, never a guess — unless `preferUnbound` (only
 * subscription.create) and exactly one of them is still unbound, which is the
 * row this new subscription belongs to.
 */
async function findOrgAddon(
  supabase: Client,
  codes: { subscriptionCode?: string; customerCode?: string; planCode?: string; preferUnbound?: boolean },
): Promise<{ row: AddonRow | null; solarPlan: boolean; foreign: boolean; error: PgError }> {
  if (codes.subscriptionCode) {
    const { data, error } = await addonTable(supabase)
      .select(ADDON_COLUMNS)
      .eq('paystack_subscription_code', codes.subscriptionCode)
      .maybeSingle()
    if (error) return { row: null, solarPlan: false, foreign: false, error: error as PgError }
    if (data) return { row: data as AddonRow, solarPlan: true, foreign: false, error: null }
  }

  const plan = solarPlanCode()
  const solarPlan = !!plan && codes.planCode === plan
  if (!solarPlan || !codes.customerCode) return { row: null, solarPlan, foreign: false, error: null }

  let { data, error } = await addonTable(supabase)
    .select(ADDON_COLUMNS)
    .eq('paystack_customer_code', codes.customerCode)
    .eq('feature_key', 'solar')
    .maybeSingle()
  if (error && (error as PgError)?.code === 'PGRST116' && codes.preferUnbound) {
    ;({ data, error } = await addonTable(supabase)
      .select(ADDON_COLUMNS)
      .eq('paystack_customer_code', codes.customerCode)
      .eq('feature_key', 'solar')
      .is('paystack_subscription_code', null)
      .maybeSingle())
  }
  if (error) {
    if ((error as PgError)?.code === 'PGRST116') {
      console.error(
        `[billing-alert] Paystack webhook: customer ${codes.customerCode} holds several Solar subscriptions; ` +
          `not guessing — a person must place this event`,
      )
      return { row: null, solarPlan, foreign: false, error: null }
    }
    return { row: null, solarPlan, foreign: false, error: error as PgError }
  }
  const row = (data as AddonRow | null) ?? null
  const foreign =
    !!row &&
    !!codes.subscriptionCode &&
    !!row.paystack_subscription_code &&
    row.paystack_subscription_code !== codes.subscriptionCode &&
    boundSubscriptionLive(row)
  return { row, solarPlan, foreign, error: null }
}

/** A failed renewal: active → past_due. Never resurrects a cancelled/refunded row. */
async function markOrgAddonPastDue(supabase: Client, row: AddonRow): Promise<PgError> {
  const { error } = await addonTable(supabase)
    .update({ status: 'past_due' })
    .eq('id', row.id)
    .eq('status', 'active')
  return (error as PgError) ?? null
}

/**
 * Refund or lost chargeback on a Solar charge → 'refunded'. Hidden but kept
 * (D-02): the helpers stop answering, every solar.* row stays untouched, and
 * a new first charge restores the lot. The org comes from the payment-event
 * row the charge branch wrote (the subscription table stores no references).
 *
 * Owner default (Phase 1B): only a refund of the charge that funded the
 * CURRENT period — the row's `last_event_id`, i.e. the latest successful
 * Solar charge applied — locks Solar. Refunding an older year's charge is
 * logged against the org (ORG_ADDON_PRIOR_PERIOD_REFUND_EVENT) and changes no
 * status: the current year was paid for separately. The `last_event_id`
 * match is repeated in the UPDATE, so a renewal applied between the read and
 * the write makes the refund change nothing rather than lock a fresh year.
 * The `.select('id')` makes the admin notification fire only when a row
 * actually changed, so a re-delivered refund notifies nobody.
 */
async function refundOrgAddonForReference(
  supabase: Client,
  reference: string,
  how: string,
  sourceEvent: string,
): Promise<{ error: PgError }> {
  const { data: charge, error: lookupErr } = await (supabase as any)
    .schema('billing')
    .from('payment_events')
    .select('organisation_id')
    .eq('event_type', ORG_ADDON_CHARGE_EVENT)
    .eq('paystack_reference', reference)
    .maybeSingle()
  if (lookupErr) return { error: lookupErr as PgError }
  const orgId = (charge as { organisation_id?: string | null } | null)?.organisation_id
  if (!orgId) return { error: null }

  const { data: row, error: readErr } = await addonTable(supabase)
    .select(ADDON_COLUMNS)
    .eq('organisation_id', orgId)
    .eq('feature_key', 'solar')
    .maybeSingle()
  if (readErr) return { error: readErr as PgError }
  const current = (row as AddonRow | null) ?? null
  if (!current) return { error: null }

  if (current.last_event_id !== reference) {
    console.info(
      `Paystack webhook: Solar charge ${reference} ${how} for org ${orgId} did not fund the current period ` +
        `(current charge ${current.last_event_id ?? 'none'}); status unchanged`,
    )
    return logPaymentEvent(supabase, {
      eventType: ORG_ADDON_PRIOR_PERIOD_REFUND_EVENT,
      reference,
      organisationId: orgId,
      payload: { how, source_event: sourceEvent, current_charge: current.last_event_id, status: current.status },
    })
  }

  const { data: changed, error: updErr } = await addonTable(supabase)
    .update({ status: 'refunded', refunded_at: new Date().toISOString() })
    .eq('id', current.id)
    .eq('last_event_id', reference)
    .neq('status', 'refunded')
    .select('id')
  if (updErr) return { error: updErr as PgError }
  if (!Array.isArray(changed) || changed.length === 0) return { error: null }

  return notifyOrgAdmins(supabase, orgId, {
    type: 'billing_refund_processed',
    title: 'Solar paused — payment refunded',
    body:
      `The Solar subscription payment ${reference} was ${how}. Solar is now locked on every ` +
      `project of this organisation. All Solar data is kept and returns if you subscribe again. ` +
      `If the Paystack subscription is still active it will charge again at renewal — cancel it in ` +
      `Paystack if Solar is no longer wanted.`,
    data: { reference, feature_key: 'solar' },
  })
}

/**
 * Apply one successful Solar charge (first or renewal) to the org's row, then
 * log it and invoice it. Order matters: grant → payment event → notification
 * → invoice, so a failure 500s before the invoice and the retry finds a
 * clean state (the same rule as every other branch in this file).
 */
async function applyOrgAddonCharge(
  supabase: Client,
  a: { orgId: string; existing: AddonRow | null; data: any; firstCharge: boolean },
): Promise<NextResponse> {
  const { orgId, existing, data, firstCharge } = a
  const reference = data.reference as string
  const amountKobo = (data.amount as number | undefined) ?? FEATURE_PRICES.solar.amountKobo
  const paidAt = (data.paid_at as string | undefined) ?? new Date().toISOString()
  const customerCode = data.customer?.customer_code as string | undefined
  const subscriptionCode = subscriptionCodeOf(data)

  // Already applied: a duplicate delivery, or a retry after a LATER write
  // failed. Skip only the grant — the payment event and invoice are idempotent
  // on the reference and must still land. (The MV branch returns early here,
  // which strands a charge with no invoice if its first attempt 500'd after
  // the grant.)
  const alreadyApplied = !!existing?.last_event_id && existing.last_event_id === reference

  // A FIRST charge (it carries initialize-time metadata) for an org whose
  // subscription is still live is a SECOND purchase — two tabs, or a race past
  // the route's 409. Money moved: book it and escalate it, never extend with it.
  const live =
    !!existing &&
    (existing.status === 'active' || existing.status === 'non_renewing') &&
    !!existing.current_period_end &&
    new Date(existing.current_period_end).getTime() > new Date(paidAt).getTime()
  // A RENEWAL from a Paystack subscription other than the one the row is bound
  // to: the duplicate purchase's second subscription, or an old subscription
  // still charging after a resubscribe. Absorbing it as a renewal would add no
  // time (the period only moves forward) while the customer pays twice a year,
  // silently. Book it as a duplicate and escalate it.
  const foreignSubscription =
    !firstCharge &&
    !!existing?.paystack_subscription_code &&
    !!subscriptionCode &&
    existing.paystack_subscription_code !== subscriptionCode &&
    boundSubscriptionLive(existing)
  const duplicatePurchase = !alreadyApplied && ((firstCharge && live) || foreignSubscription)

  // A renewal charge may revive a refunded/cancelled row only when it pays for
  // time beyond the stored end (the invoice.update rule): a replayed OLD
  // charge is booked, but does not undo the refund or cancel.
  const staleRevival =
    !firstCharge &&
    !!existing &&
    (existing.status === 'refunded' || existing.status === 'cancelled') &&
    !!existing.current_period_end &&
    new Date(nextAddonPeriodEnd(null, paidAt)).getTime() <= new Date(existing.current_period_end).getTime()

  if (!alreadyApplied && !duplicatePurchase && !staleRevival) {
    const periodEnd = nextAddonPeriodEnd(existing?.current_period_end, paidAt)
    if (existing) {
      const patch: Record<string, unknown> = {
        status: 'active',
        current_period_end: periodEnd,
        amount_kobo: amountKobo,
        last_event_id: reference,
      }
      if (customerCode) patch.paystack_customer_code = customerCode
      if (firstCharge) {
        // A resubscribe after a lapse, cancel or refund — D-02: everything
        // returns. The old Paystack subscription is dead; forget its code so
        // subscription.create can bind the new one.
        patch.paystack_subscription_code = subscriptionCode ?? null
        patch.started_at = paidAt
        patch.cancelled_at = null
        patch.refunded_at = null
      } else {
        if (subscriptionCode) patch.paystack_subscription_code = subscriptionCode
        // A renewal charge (new money, new reference) reviving a refunded or
        // cancelled row: D-02 restores it; the old end markers no longer apply.
        if (existing.status === 'refunded' || existing.status === 'cancelled') {
          patch.refunded_at = null
          patch.cancelled_at = null
        }
      }
      const { error } = await addonTable(supabase).update(patch).eq('id', existing.id)
      if (error) return storageFailure('org_addon renewal', error)
    } else {
      const { error } = await addonTable(supabase).insert({
        organisation_id: orgId,
        feature_key: 'solar',
        status: 'active',
        amount_kobo: amountKobo,
        current_period_end: periodEnd,
        paystack_customer_code: customerCode ?? null,
        paystack_subscription_code: subscriptionCode ?? null,
        last_event_id: reference,
        started_at: paidAt,
      })
      // A 23505 on org_addon_subscriptions_org_feature_key means a concurrent
      // delivery inserted first: 500, and Paystack's retry takes the update path.
      if (error) return storageFailure('org_addon grant', error)
    }
  }

  // The reference → org map a refund or chargeback needs (the subscription
  // table stores no references). A duplicate purchase is logged under its OWN
  // type, so refunding it — which the notification asks for — never matches
  // the refund lookup and locks the org's live subscription.
  const logged = await logPaymentEvent(supabase, {
    eventType: duplicatePurchase ? ORG_ADDON_DUPLICATE_EVENT : ORG_ADDON_CHARGE_EVENT,
    reference,
    organisationId: orgId,
    amountKobo,
    payload: { first_charge: firstCharge, paid_at: paidAt, subscription_code: subscriptionCode ?? null },
  })
  if (logged.error) return storageFailure('org_addon payment-event log', logged.error)

  if (duplicatePurchase) {
    const notified = await notifyOrgAdmins(supabase, orgId, {
      type: 'billing_duplicate_charge',
      title: 'Duplicate payment received',
      body: foreignSubscription
        ? `A Solar payment (reference ${reference}) was taken by Paystack subscription ` +
          `${subscriptionCode}, which is not this organisation's current Solar subscription ` +
          `(${existing?.paystack_subscription_code}). The customer is being charged twice: refund it ` +
          `and cancel subscription ${subscriptionCode} in Paystack.`
        : `A second Solar subscription payment was taken (reference ${reference}) while Solar is ` +
          `already active for this organisation. A refund is required, and the extra Paystack ` +
          `subscription should be cancelled.`,
      data: {
        reference,
        feature_key: 'solar',
        amount_kobo: amountKobo,
        ...(foreignSubscription ? { subscription_code: subscriptionCode } : {}),
      },
    })
    if (notified.error) return storageFailure('duplicate-charge notification', notified.error)
  }

  try {
    await billingService.recordInvoice(supabase as any, orgId, {
      paystackReference: reference,
      amountKobo,
      status: 'paid',
      description: duplicatePurchase
        ? 'DUPLICATE PURCHASE — Solar module subscription (already active; refund required)'
        : `Solar module subscription (annual)${firstCharge ? ' — first charge' : ' — renewal'}`,
      paidAt,
    })
  } catch (err) {
    return storageFailure('org_addon invoice', err)
  }

  return ok()
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

    // Branch A3: org add-on subscription — FIRST charge (Solar, 00208).
    // Discriminated by metadata.type set in /api/paystack/solar-subscribe.
    // Must sit before Branch B: this metadata carries org_id but no tier, so
    // it would otherwise fall to Branch C and be matched against the org's
    // TIER subscription by customer code. Renewals (metadata 0) are matched
    // in Branch C0 below.
    if (metadata.type === ORG_ADDON_METADATA_TYPE) {
      const orgId = typeof metadata.org_id === 'string' ? metadata.org_id : null
      if (!orgId || metadata.feature_key !== 'solar') {
        const logged = await logPaymentEvent(supabase, {
          eventType: ORG_ADDON_UNMATCHED_EVENT,
          reference: data.reference,
          amountKobo: data.amount,
          payload: { reason: 'metadata names no org or an unknown add-on', metadata },
        })
        if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
        return ok()
      }

      // The metadata is trusted only because the HMAC is Paystack's — but a
      // transaction can be initialised elsewhere (Inline/Popup with the public
      // key) with arbitrary metadata and amount. A year of Solar is granted only
      // for a ZAR charge on the Solar plan, or of at least the Solar price.
      const planOk = !!solarPlanCode() && planCodeOf(data) === solarPlanCode()
      const amountOk = typeof data.amount === 'number' && data.amount >= FEATURE_PRICES.solar.amountKobo
      if (data.currency !== 'ZAR' || !(planOk || amountOk)) {
        console.error(
          `[billing-alert] Paystack webhook: Solar-metadata charge ${data.reference} is not a Solar-plan ZAR ` +
            `charge (currency ${data.currency}, amount ${data.amount}, plan ${planCodeOf(data) ?? 'none'}); not granted`,
        )
        const logged = await logPaymentEvent(supabase, {
          eventType: ORG_ADDON_UNMATCHED_EVENT,
          reference: data.reference,
          organisationId: null,
          amountKobo: data.amount,
          payload: { reason: 'not a Solar-plan ZAR charge', metadata, currency: data.currency ?? null, plan: planCodeOf(data) ?? null },
        })
        if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
        return ok()
      }

      // An org that does not exist is a condition no retry can fix (the FK
      // insert would 23503 forever — a poison pill). Record the money, ack.
      const { data: org, error: orgErr } = await (supabase as any)
        .from('organisations')
        .select('id')
        .eq('id', orgId)
        .maybeSingle()
      if (orgErr) return storageFailure('org_addon organisation lookup', orgErr)
      if (!org) {
        const logged = await logPaymentEvent(supabase, {
          eventType: ORG_ADDON_UNMATCHED_EVENT,
          reference: data.reference,
          amountKobo: data.amount,
          payload: { reason: 'organisation not found', org_id: orgId },
        })
        if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
        return ok()
      }

      const { data: existing, error: readErr } = await addonTable(supabase)
        .select(ADDON_COLUMNS)
        .eq('organisation_id', orgId)
        .eq('feature_key', 'solar')
        .maybeSingle()
      if (readErr) return storageFailure('org_addon read', readErr)

      // Defensive: if Paystack repeats initialize-time metadata on a renewal,
      // a charge carrying the row's OWN bound subscription code is a renewal
      // of it, never a second purchase.
      const row = (existing as AddonRow | null) ?? null
      const chargeSub = subscriptionCodeOf(data)
      const isRenewal = !!chargeSub && !!row?.paystack_subscription_code && row.paystack_subscription_code === chargeSub
      return applyOrgAddonCharge(supabase, {
        orgId,
        existing: row,
        data,
        firstCharge: !isRenewal,
      })
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

    // Branch C0: an org add-on (Solar) renewal. Must run BEFORE the tier
    // lookup below, which matches on customer_code — the same Paystack
    // customer often pays both the tier plan and Solar, and would have this
    // charge booked as a tier renewal (flipping that subscription 'active').
    const addonRenewal = await findOrgAddon(supabase, {
      subscriptionCode: subscriptionCodeOf(data),
      customerCode,
      planCode: planCodeOf(data),
    })
    if (addonRenewal.error) return storageFailure('org_addon renewal lookup', addonRenewal.error)
    if (addonRenewal.row) {
      return applyOrgAddonCharge(supabase, {
        orgId: addonRenewal.row.organisation_id,
        existing: addonRenewal.row,
        data,
        firstCharge: false,
      })
    }
    if (addonRenewal.solarPlan) {
      console.error(
        `[billing-alert] Paystack webhook: Solar-plan charge ${data.reference} (customer ${customerCode ?? 'none'}) ` +
          `matched no Solar subscription; logged, not granted`,
      )
      const logged = await logPaymentEvent(supabase, {
        eventType: ORG_ADDON_UNMATCHED_EVENT,
        reference: data.reference,
        amountKobo: data.amount,
        payload: { reason: 'Solar-plan charge matched no subscription', customer_code: customerCode ?? null },
      })
      if (logged.error) return storageFailure('org_addon unmatched log', logged.error)
      return ok()
    }

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

    // Not an org or MV subscription — try the org add-on (Solar).
    const addon = await findOrgAddon(supabase, { subscriptionCode })
    if (addon.error) return storageFailure('org_addon invoice lookup', addon.error)
    if (addon.row) {
      if (paid) {
        const row = addon.row
        const storedEnd = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN
        // The period THIS invoice pays for, independent of the stored end.
        const invoicedEnd = nextAddonPeriodEnd(null, inv.paid_at as string | undefined, nextPaymentDate)
        const extendsPeriod = !Number.isFinite(storedEnd) || new Date(invoicedEnd).getTime() > storedEnd

        let patch: Record<string, unknown> | null
        let fromStatuses: string[]
        if (row.status === 'refunded') {
          // A refunded row comes back only for a genuinely NEW charge: a
          // different reference from the refunded one AND a period beyond the
          // refunded period. A late or re-delivered invoice for the refunded
          // charge must leave it refunded (D-02: hidden until a new payment).
          const newCharge = !!reference && reference !== row.last_event_id && extendsPeriod
          patch = newCharge
            ? { status: 'active', current_period_end: invoicedEnd, last_event_id: reference, refunded_at: null }
            : null
          fromStatuses = ['refunded']
        } else if (row.status === 'cancelled') {
          // A cancelled row reactivates only for a NEW future period (a
          // resubscribe); a stale invoice leaves it cancelled.
          const future = new Date(invoicedEnd).getTime() > Date.now()
          patch = future && extendsPeriod
            ? { status: 'active', current_period_end: invoicedEnd, cancelled_at: null, ...(reference ? { last_event_id: reference } : {}) }
            : null
          fromStatuses = ['cancelled']
        } else if (row.status === 'non_renewing') {
          // The customer chose not to renew. Only a paid invoice for a NEW,
          // later period (they renewed after all) makes it 'active' again; a
          // late invoice for an earlier charge must not undo the choice.
          patch = extendsPeriod
            ? { status: 'active', current_period_end: invoicedEnd, ...(reference ? { last_event_id: reference } : {}) }
            : null
          fromStatuses = ['non_renewing']
        } else {
          patch = {
            status: 'active',
            current_period_end: nextAddonPeriodEnd(row.current_period_end, inv.paid_at as string | undefined, nextPaymentDate),
          }
          // The charge that funds a NEW period becomes the current charge, so a
          // refund of it locks Solar even if its charge.success never matched.
          if (reference && extendsPeriod) patch.last_event_id = reference
          // Guarded so a refund or cancel landing between the read and this
          // write is never overwritten.
          fromStatuses = ['active', 'past_due']
        }

        if (!patch) {
          console.info(
            `Webhook invoice.update: Solar row ${row.id} is ${row.status}; invoice ${reference ?? '(no ref)'} is not a new charge, left unchanged`,
          )
          return ok()
        }
        const query = addonTable(supabase).update(patch).eq('id', row.id)
        const { error: addonErr } =
          fromStatuses.length === 1 ? await query.eq('status', fromStatuses[0]) : await query.in('status', fromStatuses)
        if (addonErr) return storageFailure('org_addon renewal update', addonErr)

        // Record the reference → org map a refund of this charge needs
        // (idempotent with the one charge.success writes for the same reference).
        if (reference && patch.last_event_id === reference) {
          const logged = await logPaymentEvent(supabase, {
            eventType: ORG_ADDON_CHARGE_EVENT,
            reference,
            organisationId: row.organisation_id,
            amountKobo,
            payload: { via: 'invoice.update', subscription_code: subscriptionCode, paid_at: inv.paid_at ?? null },
          })
          if (logged.error) return storageFailure('org_addon payment-event log', logged.error)
        }
      } else {
        const failErr = await markOrgAddonPastDue(supabase, addon.row)
        if (failErr) return storageFailure('org_addon past_due', failErr)
      }
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

    const addonRefund = await refundOrgAddonForReference(supabase, reference, 'refunded', event.event)
    if (addonRefund.error) return storageFailure('org_addon refund', addonRefund.error)

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

    // A chargeback the merchant LOST ('merchant-accepted') is money gone back
    // to the cardholder: Solar goes to 'refunded' (D-02), under the same
    // current-period rule as a refund. An opened or merchant-won dispute takes
    // nothing away. ⚠ UNVERIFIED: confirm the charge.dispute.resolve payload's
    // `resolution` values in Paystack test mode before relying on this.
    if (event.event === 'charge.dispute.resolve' && data.resolution === 'merchant-accepted') {
      const addonChargeback = await refundOrgAddonForReference(supabase, reference, 'charged back', event.event)
      if (addonChargeback.error) return storageFailure('org_addon chargeback', addonChargeback.error)
    }

    return ok()
  }

  // A failed charge — the initial checkout charge or a recurring renewal —
  // opens the payment-failure cycle the recovery cron escalates.
  if (event.event === 'charge.failed') {
    const data = event.data
    const failedMeta: Record<string, any> =
      data.metadata && typeof data.metadata === 'object' ? data.metadata : {}

    // Org add-on (Solar). A failed FIRST charge holds nothing (the row is only
    // created on success) and its metadata.org_id must NOT fall through to the
    // tier lookup below, which would mark the org's tier plan past_due and
    // start the payment-pause cron. A failed RENEWAL is the add-on's own
    // past_due. A Solar-plan failure matching no row is acknowledged, never
    // pinned on the tier plan.
    if (failedMeta.type === ORG_ADDON_METADATA_TYPE) return ok()
    const addonFailed = await findOrgAddon(supabase, {
      subscriptionCode: subscriptionCodeOf(data),
      customerCode: data.customer?.customer_code,
      planCode: planCodeOf(data),
    })
    if (addonFailed.error) return storageFailure('org_addon failure lookup', addonFailed.error)
    // A failure of a FOREIGN subscription (not the one the row is bound to)
    // must not lock the live row; it is still a Solar-plan event, so it never
    // reaches the tier lookup either (solarPlan below).
    if (addonFailed.row && !addonFailed.foreign) {
      const failErr = await markOrgAddonPastDue(supabase, addonFailed.row)
      if (failErr) return storageFailure('org_addon past_due', failErr)
      return ok()
    }
    if (addonFailed.solarPlan) return ok()

    const orgId = failedMeta.org_id as string | undefined
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

    // Org add-on (Solar): bind the Paystack subscription code the first
    // charge usually does not carry, so not_renew/disable/invoice.update can
    // find the row by code. Status is NOT touched — creating a subscription is
    // not payment, and must not resurrect a refunded row.
    //
    // It binds ONLY a row that is unbound or already bound to this very code:
    // the second subscription of a duplicate purchase (or of one customer
    // paying for two orgs) must never steal the live row's binding — a later
    // disable of the duplicate would then end the real one. The same guard is
    // repeated in the UPDATE so a concurrent bind cannot be overwritten.
    const newCode = typeof sub.subscription_code === 'string' ? sub.subscription_code : ''
    const addon = await findOrgAddon(supabase, {
      subscriptionCode: newCode || undefined,
      customerCode,
      planCode,
      preferUnbound: true,
    })
    if (addon.error) return storageFailure('org_addon subscription.create lookup', addon.error)
    if (addon.row && addon.foreign) {
      console.warn(
        `Paystack webhook subscription.create: ${newCode} is not the Solar subscription bound to row ` +
          `${addon.row.id} (${addon.row.paystack_subscription_code}); not re-binding`,
      )
    } else if (addon.row && /^[A-Za-z0-9_-]+$/.test(newCode)) {
      const oldCode = addon.row.paystack_subscription_code
      const patch: Record<string, unknown> = { paystack_subscription_code: newCode }
      // Only an ACTIVE row's period may follow next_payment_date here. On any
      // other row (an ended non_renewing / cancelled / refunded binding being
      // taken over) moving the end forward would grant access from an event
      // that is not a payment, and turn the real first charge into a
      // "duplicate". The charge that follows sets the period.
      if (sub.next_payment_date && addon.row.status === 'active' && !(oldCode && oldCode !== newCode)) {
        patch.current_period_end = nextAddonPeriodEnd(addon.row.current_period_end, null, sub.next_payment_date)
      }
      const bind = addonTable(supabase).update(patch).eq('id', addon.row.id)
      // Unbound or already ours: guard against a concurrent bind. Bound to an
      // ENDED subscription (not foreign, see boundSubscriptionLive): take it
      // over only if the binding is still the one we read.
      const { error: bindErr } =
        oldCode && oldCode !== newCode
          ? await bind.eq('paystack_subscription_code', oldCode)
          : await bind.or(`paystack_subscription_code.is.null,paystack_subscription_code.eq.${newCode}`)
      if (bindErr) return storageFailure('org_addon subscription.create', bindErr)
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

    // Org add-on (Solar). Unlike the tier subscription above, these events do
    // not simply end access (spec §2.3.4): not_renew keeps access until
    // current_period_end (org_subscription_active admits 'non_renewing').
    // disable (owner default, Phase 1B) honours a year that is already paid
    // for: while current_period_end is still in the future it is treated like
    // not_renew ('non_renewing', access to the period end); once the period
    // has ended it is 'cancelled'. The status guards stop a late or
    // re-delivered event from moving a row backwards (neither ever overwrites
    // 'refunded' or revives 'cancelled').
    const addon = await findOrgAddon(supabase, {
      subscriptionCode: sub.subscription_code,
      customerCode: sub.customer?.customer_code,
      planCode: sub.plan?.plan_code,
    })
    if (addon.error) return storageFailure('org_addon cancel lookup', addon.error)
    // A FOREIGN subscription (the duplicate the admins were told to cancel, or
    // an old one outlived by a resubscribe) ending must not touch the live row.
    if (addon.row && !addon.foreign) {
      const row = addon.row
      const periodEnd = row.current_period_end ? new Date(row.current_period_end).getTime() : NaN
      const stillPaidFor = Number.isFinite(periodEnd) && periodEnd > Date.now()
      // Only an ACTIVE row becomes 'non_renewing' (which the helper treats as
      // live): a past_due row is locked (D6) and must never be unlocked by a
      // not-renew or disable. not_renew leaves past_due alone; disable ends it.
      let result: { error: unknown } | null = null
      if (event.event === 'subscription.not_renew' || (stillPaidFor && row.status === 'active')) {
        result = await addonTable(supabase)
          .update({ status: 'non_renewing' })
          .eq('id', row.id)
          .eq('status', 'active')
      } else if (event.event === 'subscription.disable' && (!stillPaidFor || row.status === 'past_due')) {
        // A disable while the paid period still runs never ends it (D2): an
        // active row went to non_renewing above, and a non_renewing row — a
        // re-delivered disable, or Paystack's end-of-term disable arriving a
        // few hours before our stored end — is left alone. past_due is
        // already locked (D6), so ending it is no loss of paid access.
        result = await addonTable(supabase)
          .update({ status: 'cancelled', cancelled_at: new Date().toISOString() })
          .eq('id', row.id)
          .in('status', ['active', 'non_renewing', 'past_due'])
      }
      if (result?.error) return storageFailure('org_addon cancel', result.error)
    }
  }

  // A subscription renewal invoice failed — the primary Paystack signal for a
  // failed recurring charge. Open/extend the recovery cycle.
  if (event.event === 'invoice.payment_failed') {
    const inv = event.data
    const subCode = inv.subscription?.subscription_code as string | undefined
    if (subCode) {
      const sub = await findSubscription(supabase, 'paystack_subscription_code', subCode)
      if (sub) await recordPaymentFailure(supabase, sub)

      const addon = await findOrgAddon(supabase, { subscriptionCode: subCode })
      if (addon.error) return storageFailure('org_addon failure lookup', addon.error)
      if (addon.row) {
        const failErr = await markOrgAddonPastDue(supabase, addon.row)
        if (failErr) return storageFailure('org_addon past_due', failErr)
      }
    }
  }

  return ok()
}
