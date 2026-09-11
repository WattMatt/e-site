import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { billingService, OWNER_ADMIN } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { safeReturnTo, DEFAULT_RETURN_TO } from '@/lib/paystack/return-to'
import { addBillingPeriod } from '@/lib/paystack/billing-period'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

/** Append query params to a path that may already carry a query string. */
function withParams(path: string, params: Record<string, string>): string {
  const query = new URLSearchParams(params).toString()
  return `${path}${path.includes('?') ? '&' : '?'}${query}`
}

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reference = searchParams.get('reference')
  if (!reference || !PAYSTACK_SECRET) {
    return NextResponse.redirect(new URL(`${DEFAULT_RETURN_TO}?error=invalid`, req.url))
  }

  // Verify the transaction with Paystack
  const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  })
  const body = await res.json()

  const data = body?.data ?? {}
  // Paystack sends a literal `"metadata": 0` on some payloads; normalise before
  // any property read.
  const metadata: Record<string, any> =
    data.metadata && typeof data.metadata === 'object' ? data.metadata : {}

  // ⚠ `return_to` arrives inside Paystack's verify response and is fed to
  // `new URL(x, req.url)`, which happily resolves an absolute or
  // protocol-relative value off-site. Validated on the way out (at initialize
  // time) AND here on the way back.
  const returnTo = safeReturnTo(metadata.return_to)

  if (!body?.status || data.status !== 'success') {
    return NextResponse.redirect(new URL(withParams(returnTo, { error: 'failed' }), req.url))
  }

  // ── Non-subscription purchases ───────────────────────────────────────────
  // Branch on metadata.type BEFORE the org_id/tier gate below. feature_unlock,
  // feature_seat and mv_subscription carry no `tier` (mv carries no `org_id`
  // either), so every one of them used to fall into ?error=meta — a customer
  // who had just paid R250, R1,999 or R2,000 landed on an unrelated page with
  // no confirmation, which is the realistic path into paying twice.
  //
  // The webhook remains the SOLE writer of these entitlements: a single writer
  // keeps the duplicate-purchase (23505) handling in one place. The buyer may
  // therefore arrive a second or two before the grant lands, so the
  // destination is told `payment=received` rather than being asserted as
  // already unlocked.
  const purchaseType = metadata.type
  if (
    purchaseType === 'feature_unlock' ||
    purchaseType === 'feature_seat' ||
    purchaseType === 'mv_subscription'
  ) {
    return NextResponse.redirect(
      new URL(withParams(returnTo, { payment: 'received', ref: reference }), req.url),
    )
  }

  const { org_id, tier, period, amount_kobo, plan_code, mode } = metadata
  if (!org_id || !tier) {
    return NextResponse.redirect(new URL(withParams(returnTo, { error: 'meta' }), req.url))
  }

  // ── Authorisation ────────────────────────────────────────────────────────
  // `org_id` comes out of the TRANSACTION's metadata, not out of the caller's
  // session, and everything below writes with the service client (RLS
  // bypassed). Without this gate anyone holding a reference could GET this
  // route and rewrite that org's subscription tier — and until 00187 the
  // billing.invoices SELECT policy was role-blind, so every reference was
  // readable by every member of the org.
  //
  // Deliberately requireRole (the primitive, against the metadata's org id),
  // not requireRoleAPI: the caller's *primary* org is irrelevant here, and a
  // JSON 403 would render as a blank page to a user arriving back from
  // Paystack's hosted checkout. Refusals redirect to the billing page.
  //
  // Safe for the happy path: /api/paystack/checkout sets metadata.org_id from
  // the payer's own OWNER_ADMIN org, and Supabase's SameSite=Lax auth cookies
  // are sent on this top-level cross-site GET.
  const userClient = await createClient()
  const guard = await requireRole(userClient, org_id, OWNER_ADMIN)
  if (!guard.ok) {
    return NextResponse.redirect(new URL('/settings/billing?error=forbidden', req.url))
  }

  const supabase = createServiceClient()

  // ── Replay guard ─────────────────────────────────────────────────────────
  // The role gate above does not cover an owner replaying their OWN paid
  // reference. recordInvoice is idempotent on paystack_reference, but
  // upsertSubscription is not: a replay would flip a cancelled or past_due
  // subscription back to `active` with no new charge and no new invoice row,
  // leaving subscriptions.updated_at as the only trace.
  //
  // This also covers the benign race in which the (signature-verified) webhook
  // beat the browser back: webhook branch B writes the same subscription from
  // the same metadata before recording the invoice, so if the invoice exists
  // the subscription is already current and there is nothing to do.
  const { data: existingInvoice } = await (supabase as any)
    .schema('billing')
    .from('invoices')
    .select('id')
    .eq('paystack_reference', reference)
    .maybeSingle()

  if (existingInvoice) {
    return NextResponse.redirect(new URL('/settings/billing?success=1', req.url))
  }

  // Path B note: when this transaction was a recurring subscription
  // (mode === 'recurring' / plan_code present), Paystack created the
  // subscription server-side but the verify response does NOT always include
  // the subscription_code synchronously. The webhook `subscription.create`
  // event arrives within ~5–30s and fills in `paystack_subscription_code`
  // by matching on (paystack_customer_code + paystack_plan_code). The
  // intentional race is documented in the webhook handler.
  await billingService.upsertSubscription(supabase as any, org_id, {
    tier,
    billingPeriod: period ?? 'monthly',
    status: 'active',
    paystackCustomerCode: data.customer?.customer_code,
    paystackPlanCode: plan_code ?? data.plan_object?.plan_code ?? data.plan ?? undefined,
    // paystackSubscriptionCode intentionally omitted — webhook will fill it.
    amountKobo: amount_kobo ?? data.amount,
    // Finding #19: nothing wrote next_billing_date in one-off mode, so it
    // stayed NULL, `NULL < today` is NULL, and downgradeExpiredCancellations
    // could never select the row — a cancelled customer kept their tier
    // forever. `subscription.create` overwrites this with Paystack's own
    // next_payment_date when the transaction was recurring.
    nextBillingDate: addBillingPeriod(data.paid_at as string | undefined, period ?? 'monthly'),
  })

  await billingService.recordInvoice(supabase as any, org_id, {
    paystackReference: reference,
    amountKobo: data.amount,
    status: 'paid',
    description: `${tier} plan (${period ?? 'monthly'})${mode === 'recurring' ? ' — first charge' : ''}`,
    paidAt: new Date().toISOString(),
  })

  return NextResponse.redirect(new URL('/settings/billing?success=1', req.url))
}
