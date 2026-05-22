import { NextRequest, NextResponse } from 'next/server'
import { createHmac, timingSafeEqual } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { billingService } from '@esite/shared'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

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
async function recordPaymentFailure(
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
  sub: SubscriptionFailureRow,
): Promise<void> {
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
  supabase: Awaited<ReturnType<typeof createServiceClient>>,
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
    const { org_id, tier, period, amount_kobo, plan_code, mode } = data.metadata ?? {}
    if (org_id && tier) {
      await billingService.upsertSubscription(supabase as any, org_id, {
        tier,
        billingPeriod: period ?? 'monthly',
        status: 'active',
        paystackCustomerCode: data.customer?.customer_code,
        paystackPlanCode: plan_code ?? data.plan_object?.plan_code ?? data.plan ?? undefined,
        amountKobo: amount_kobo ?? data.amount,
      }).catch(console.error)

      // A successful charge clears any open failure cycle so the recovery cron
      // stops chasing a customer who has now paid.
      const { error: resetError } = await (supabase as any)
        .schema('billing')
        .from('subscriptions')
        .update({ payment_failure_count: 0, last_payment_failure_at: null })
        .eq('organisation_id', org_id)
        .gt('payment_failure_count', 0)
      if (resetError) console.error('Webhook failure-reset error:', resetError)

      // Idempotent on paystack_reference — safe against duplicate deliveries
      // and the callback recording the same first charge.
      await billingService.recordInvoice(supabase as any, org_id, {
        paystackReference: data.reference,
        amountKobo: data.amount,
        status: 'paid',
        description: `${tier} plan charge${mode === 'recurring' ? ' (recurring)' : ''}`,
        paidAt: new Date().toISOString(),
      }).catch(console.error)
    }
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

  return NextResponse.json({ received: true })
}
