import { NextRequest, NextResponse } from 'next/server'
import { createServiceClient } from '@/lib/supabase/server'
import { billingService } from '@esite/shared'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

export async function GET(req: NextRequest) {
  const { searchParams } = new URL(req.url)
  const reference = searchParams.get('reference')
  if (!reference || !PAYSTACK_SECRET) {
    return NextResponse.redirect(new URL('/settings/billing?error=invalid', req.url))
  }

  // Verify the transaction with Paystack
  const res = await fetch(`https://api.paystack.co/transaction/verify/${reference}`, {
    headers: { Authorization: `Bearer ${PAYSTACK_SECRET}` },
  })
  const body = await res.json()

  if (!body.status || body.data?.status !== 'success') {
    return NextResponse.redirect(new URL('/settings/billing?error=failed', req.url))
  }

  const data = body.data
  const { org_id, tier, period, amount_kobo, plan_code, mode } = data.metadata ?? {}
  if (!org_id || !tier) {
    return NextResponse.redirect(new URL('/settings/billing?error=meta', req.url))
  }

  // Path B note: when this transaction was a recurring subscription
  // (mode === 'recurring' / plan_code present), Paystack created the
  // subscription server-side but the verify response does NOT always include
  // the subscription_code synchronously. The webhook `subscription.create`
  // event arrives within ~5–30s and fills in `paystack_subscription_code`
  // by matching on (paystack_customer_code + paystack_plan_code). The
  // intentional race is documented in the webhook handler.
  const supabase = createServiceClient()
  await billingService.upsertSubscription(supabase as any, org_id, {
    tier,
    billingPeriod: period ?? 'monthly',
    status: 'active',
    paystackCustomerCode: data.customer?.customer_code,
    paystackPlanCode: plan_code ?? data.plan_object?.plan_code ?? data.plan ?? undefined,
    // paystackSubscriptionCode intentionally omitted — webhook will fill it.
    amountKobo: amount_kobo ?? data.amount,
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
