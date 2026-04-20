/**
 * Edge Function: paystack-webhook
 *
 * Receives and processes Paystack webhook events.
 * Verifies HMAC SHA-512 signature before processing.
 *
 * Events handled:
 *   charge.success           → mark order paid, create commission record
 *   charge.failed            → increment subscription failure counter, email day-0 notice
 *   transfer.success         → mark payout complete
 *   transfer.failed          → mark payout failed, log reason
 *   subscription.create      → create/activate subscription record
 *   subscription.disable     → deactivate subscription
 *   invoice.create           → record pending invoice
 *   invoice.update           → update invoice status (paid / failed)
 *
 * Spec § 7.5, § 8.1, § 13.3, § 18  |  CLAUDE.md §3.2, §10 point 9
 * Paystack docs: https://paystack.com/docs/payments/webhooks/
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { sendSequenceEmail, getSiteUrl, unsubscribeUrlFor } from '../_shared/email-sequence.ts'
import { paymentDay0Failed } from '../_shared/email-templates/payment-day0-failed.ts'

// ─── HMAC SHA-512 verification ────────────────────────────────────────────────

async function verifyPaystackSignature(body: string, signature: string, secret: string): Promise<boolean> {
  const encoder = new TextEncoder()

  const key = await crypto.subtle.importKey(
    'raw',
    encoder.encode(secret),
    { name: 'HMAC', hash: 'SHA-512' },
    false,
    ['verify'],
  )

  // Decode the hex signature to bytes then use crypto.subtle.verify() which is
  // timing-safe — avoids the string-comparison timing leak in the original.
  if (signature.length % 2 !== 0) return false
  const sigBytes = new Uint8Array(signature.length / 2)
  for (let i = 0; i < signature.length; i += 2) {
    const byte = parseInt(signature.slice(i, i + 2), 16)
    if (isNaN(byte)) return false
    sigBytes[i / 2] = byte
  }

  return crypto.subtle.verify('HMAC', key, sigBytes, encoder.encode(body))
}

// ─── Event handlers ───────────────────────────────────────────────────────────

async function handleChargeSuccess(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const reference = data.reference as string
  const amountKobo = data.amount as number
  const metadata = (data.metadata as Record<string, unknown>) ?? {}
  const orderId = metadata.order_id as string | undefined
  const commissionRate = Number(metadata.commission_rate ?? 0.06)

  if (!orderId) {
    // Subscription charge — handled by invoice.update
    console.log(`charge.success ref=${reference} no orderId — skipping (subscription)`)
    return
  }

  // Idempotency: skip if commission record already exists
  const { data: existing } = await supabase
    .schema('marketplace')
    .from('commission_records')
    .select('id')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (existing) {
    console.log(`Duplicate charge.success ref=${reference} — ignoring`)
    return
  }

  // Commission calculation: round UP for E-Site
  const commissionKobo = Math.ceil(amountKobo * commissionRate)
  const supplierKobo = amountKobo - commissionKobo

  // Fetch order to get org IDs and split code
  const { data: order, error: orderErr } = await supabase
    .schema('marketplace')
    .from('orders')
    .select('id, contractor_org_id, supplier_org_id, supplier_id, paystack_split_code')
    .eq('id', orderId)
    .single()

  if (orderErr || !order) {
    throw new Error(`Order ${orderId} not found: ${orderErr?.message}`)
  }

  // Look up supplier subaccount code
  const { data: subaccount } = await supabase
    .schema('marketplace')
    .from('paystack_subaccounts')
    .select('subaccount_code')
    .eq('supplier_id', order.supplier_id)
    .maybeSingle()

  // Update order payment_status and paid_at
  const { error: updateErr } = await supabase
    .schema('marketplace')
    .from('orders')
    .update({
      payment_status: 'paid',
      paid_at: (data.paid_at as string) ?? new Date().toISOString(),
      paystack_reference: reference,
    })
    .eq('id', orderId)

  if (updateErr) throw new Error(`Failed to update order: ${updateErr.message}`)

  // Create commission record
  const { error: commErr } = await supabase
    .schema('marketplace')
    .from('commission_records')
    .insert({
      order_id: orderId,
      contractor_org_id: order.contractor_org_id,
      supplier_org_id: order.supplier_org_id,
      supplier_subaccount_code: subaccount?.subaccount_code ?? null,
      paystack_reference: reference,
      paystack_split_code: order.paystack_split_code,
      gross_amount_kobo: amountKobo,
      commission_rate: commissionRate,
      commission_kobo: commissionKobo,
      supplier_kobo: supplierKobo,
      payout_status: 'pending',
    })

  if (commErr) throw new Error(`Failed to create commission record: ${commErr.message}`)

  console.log(
    `charge.success orderId=${orderId} ref=${reference} ` +
    `gross=${amountKobo} commission=${commissionKobo} supplier=${supplierKobo}`,
  )
}

async function handleTransferSuccess(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const transferCode = (data.transfer_code as string) ?? ''
  const reference = data.reference as string

  // Update commission_records by payout_reference
  await supabase
    .schema('marketplace')
    .from('commission_records')
    .update({
      payout_status: 'paid',
      payout_completed_at: new Date().toISOString(),
    })
    .eq('payout_reference', reference)

  // Update commission_payouts table
  await supabase
    .schema('marketplace')
    .from('commission_payouts')
    .update({ status: 'success', completed_at: new Date().toISOString() })
    .eq('paystack_transfer_code', transferCode)

  console.log(`transfer.success ref=${reference} code=${transferCode}`)
}

async function handleTransferFailed(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const transferCode = (data.transfer_code as string) ?? ''
  const reference = data.reference as string
  const reason = (data.reason as string) ?? 'Unknown'

  await supabase
    .schema('marketplace')
    .from('commission_records')
    .update({
      payout_status: 'failed',
      payout_failed_at: new Date().toISOString(),
      payout_failure_reason: reason,
    })
    .eq('payout_reference', reference)

  await supabase
    .schema('marketplace')
    .from('commission_payouts')
    .update({ status: 'failed', failure_reason: reason })
    .eq('paystack_transfer_code', transferCode)

  console.error(`transfer.failed ref=${reference} code=${transferCode} reason=${reason}`)
}

async function handleSubscriptionCreate(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const customer = data.customer as Record<string, unknown>
  const plan = data.plan as Record<string, unknown>
  const subscriptionCode = data.subscription_code as string
  const nextPaymentDate = data.next_payment_date as string | undefined
  const customerEmail = customer?.email as string

  // Find the organisation by customer email
  const { data: profile } = await supabase
    .from('profiles')
    .select('id, user_organisations(organisation_id)')
    .eq('email', customerEmail)
    .maybeSingle()

  if (!profile?.user_organisations?.length) {
    console.warn(`subscription.create: no org found for email=${customerEmail}`)
    return
  }

  const orgId = (profile.user_organisations as any[])[0]?.organisation_id as string

  await supabase
    .schema('billing')
    .from('subscriptions')
    .upsert(
      {
        organisation_id: orgId,
        paystack_subscription_code: subscriptionCode,
        paystack_customer_code: customer?.customer_code as string,
        paystack_plan_code: plan?.plan_code as string,
        tier: (plan?.metadata as any)?.tier ?? 'starter',
        status: 'active',
        next_billing_date: nextPaymentDate,
      },
      { onConflict: 'organisation_id' },
    )

  console.log(`subscription.create orgId=${orgId} code=${subscriptionCode}`)
}

async function handleSubscriptionDisable(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const subscriptionCode = data.subscription_code as string

  await supabase
    .schema('billing')
    .from('subscriptions')
    .update({ status: 'cancelled' })
    .eq('paystack_subscription_code', subscriptionCode)

  console.log(`subscription.disable code=${subscriptionCode}`)
}

async function handleInvoiceUpdate(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  const reference = data.transaction?.reference as string | undefined
  const amountKobo = data.amount as number
  const status = (data.status as string) === 'success' ? 'paid' : 'failed'
  const subscriptionCode = data.subscription?.subscription_code as string | undefined
  const paidAt = status === 'paid' ? (data.paid_at as string ?? new Date().toISOString()) : undefined

  if (!subscriptionCode) return

  // Find org from subscription
  const { data: sub } = await supabase
    .schema('billing')
    .from('subscriptions')
    .select('organisation_id')
    .eq('paystack_subscription_code', subscriptionCode)
    .maybeSingle()

  if (!sub) return

  // Record invoice
  await supabase.schema('billing').from('invoices').insert({
    organisation_id: sub.organisation_id,
    paystack_reference: reference ?? `sub-${subscriptionCode}-${Date.now()}`,
    amount_kobo: amountKobo,
    status,
    description: `Subscription payment`,
    paid_at: paidAt,
  })

  // Update subscription status
  if (status === 'paid') {
    // Reset the recovery counter so a future failure starts from day 0.
    await supabase
      .schema('billing')
      .from('subscriptions')
      .update({ status: 'active', payment_failure_count: 0, last_payment_failure_at: null })
      .eq('paystack_subscription_code', subscriptionCode)

    // Restore any projects that were paused by the recovery flow.
    await supabase
      .schema('projects')
      .from('projects')
      .update({ status: 'active' })
      .eq('organisation_id', sub.organisation_id)
      .eq('status', 'payment_paused')
  } else {
    await supabase
      .schema('billing')
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('paystack_subscription_code', subscriptionCode)
  }

  console.log(`invoice.update ref=${reference} status=${status} subscriptionCode=${subscriptionCode}`)
}

async function handleChargeFailed(
  supabase: ReturnType<typeof createClient>,
  data: Record<string, unknown>,
): Promise<void> {
  // Paystack delivers charge.failed for both one-off orders and subscription
  // renewals. Only the subscription case is the payment-recovery signal — a
  // failed one-off order is already surfaced via the existing order flow.
  const customer = (data.customer as Record<string, unknown>) ?? {}
  const customerEmail = customer.email as string | undefined
  const customerCode = customer.customer_code as string | undefined
  const amountKobo = (data.amount as number) ?? 0
  const reference = (data.reference as string) ?? ''

  if (!customerCode && !customerEmail) {
    console.warn(`charge.failed ref=${reference}: no customer identifier, skipping`)
    return
  }

  // Find the subscription via paystack_customer_code first, fall back to email.
  let subQuery = (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .select('id, organisation_id, payment_failure_count, status, paystack_customer_code')
  if (customerCode) {
    subQuery = subQuery.eq('paystack_customer_code', customerCode)
  } else if (customerEmail) {
    // customer_code wasn't supplied — try to resolve via profile email → org → subscription
    const { data: profile } = await supabase
      .from('profiles')
      .select('id, user_organisations(organisation_id)')
      .eq('email', customerEmail)
      .maybeSingle()
    const orgId = (profile?.user_organisations as any[] | undefined)?.[0]?.organisation_id
    if (!orgId) {
      console.warn(`charge.failed ref=${reference}: no org for email=${customerEmail}`)
      return
    }
    subQuery = subQuery.eq('organisation_id', orgId)
  }

  const { data: sub, error: subErr } = await subQuery.maybeSingle()
  if (subErr || !sub) {
    console.warn(`charge.failed ref=${reference}: subscription not found (${subErr?.message ?? 'no row'})`)
    return
  }

  if ((sub as any).status === 'cancelled') {
    console.log(`charge.failed ref=${reference}: subscription already cancelled, skipping`)
    return
  }

  // Increment counter + stamp the failure timestamp. Moves status to
  // 'past_due' if currently 'active' — graduation to 'grace_period' / 'paused'
  // happens later via the payment-recovery-check cron.
  const nextCount = ((sub as any).payment_failure_count ?? 0) + 1
  const nextStatus = (sub as any).status === 'active' ? 'past_due' : (sub as any).status

  await (supabase as any)
    .schema('billing')
    .from('subscriptions')
    .update({
      payment_failure_count:   nextCount,
      last_payment_failure_at: new Date().toISOString(),
      status:                  nextStatus,
    })
    .eq('id', (sub as any).id)

  // Send the Day-0 "payment failed" email. Idempotent via email_sequence_events
  // UNIQUE — if charge.failed fires multiple times within the recovery window
  // for the same sub, we only email the first time.
  const { data: ownerProfile } = await (supabase as any)
    .from('user_organisations')
    .select('user_id, profile:profiles!user_id(id, full_name, email)')
    .eq('organisation_id', (sub as any).organisation_id)
    .eq('role', 'org_admin')
    .eq('is_active', true)
    .limit(1)
    .maybeSingle()

  const owner = ownerProfile?.profile as { id: string; full_name: string | null; email: string | null } | null
  if (!owner?.id || !owner.email) {
    console.warn(`charge.failed ref=${reference}: no org admin to email`)
    return
  }

  const amountZAR = `R${(amountKobo / 100).toFixed(2)}`
  const { subject, html } = paymentDay0Failed({
    firstName: owner.full_name?.split(' ')[0] ?? '',
    amountZAR,
    siteUrl: getSiteUrl(),
    unsubscribeUrl: unsubscribeUrlFor(owner.id),
  })

  const result = await sendSequenceEmail(supabase as any, {
    userId:         owner.id,
    toEmail:        owner.email,
    organisationId: (sub as any).organisation_id,
    sequence:       'payment_recovery',
    step:           'day0_failed',
    subject,
    html,
    metadata: { reference, failure_count: nextCount },
  })

  console.log(
    `charge.failed ref=${reference} sub=${(sub as any).id} count=${nextCount} status=${nextStatus} email=${result.status}`,
  )
}

// ─── Main handler ─────────────────────────────────────────────────────────────

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'x-paystack-signature, content-type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const signature = req.headers.get('x-paystack-signature') ?? ''
  const rawBody = await req.text()

  // Verify HMAC SHA-512 signature — MUST happen before any processing
  const secret = Deno.env.get('PAYSTACK_SECRET_KEY')
  if (!secret) {
    console.error('PAYSTACK_SECRET_KEY not configured')
    return new Response('Server misconfiguration', { status: 500 })
  }

  const valid = await verifyPaystackSignature(rawBody, signature, secret)
  if (!valid) {
    console.warn('Invalid Paystack signature — rejecting webhook')
    return new Response('Invalid signature', { status: 401 })
  }

  let event: { event: string; data: Record<string, unknown> }
  try {
    event = JSON.parse(rawBody)
  } catch {
    return new Response('Invalid JSON', { status: 400 })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  )

  try {
    switch (event.event) {
      case 'charge.success':
        await handleChargeSuccess(supabase, event.data)
        break
      case 'charge.failed':
        await handleChargeFailed(supabase, event.data)
        break
      case 'transfer.success':
        await handleTransferSuccess(supabase, event.data)
        break
      case 'transfer.failed':
      case 'transfer.reversed':
        await handleTransferFailed(supabase, event.data)
        break
      case 'subscription.create':
        await handleSubscriptionCreate(supabase, event.data)
        break
      case 'subscription.disable':
      case 'subscription.not_renew':
        await handleSubscriptionDisable(supabase, event.data)
        break
      case 'invoice.create':
        // No action needed — wait for invoice.update to confirm payment
        break
      case 'invoice.update':
        await handleInvoiceUpdate(supabase, event.data)
        break
      case 'invoice.payment_failed':
        // Subscription renewal charge failed: record the invoice AND kick off
        // the payment-recovery timeline in the same tick.
        await handleInvoiceUpdate(supabase, event.data)
        await handleChargeFailed(supabase, event.data)
        break
      default:
        console.log(`Unhandled event: ${event.event}`)
    }

    return new Response(JSON.stringify({ received: true }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`Error processing ${event.event}: ${message}`)
    // Return 200 to prevent Paystack retries on logic errors
    // Return 500 only for transient errors (DB unavailable etc.)
    return new Response(JSON.stringify({ error: message }), {
      status: message.includes('not found') ? 200 : 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
})
