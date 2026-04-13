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

  const { org_id, tier, period, amount_kobo } = body.data.metadata ?? {}
  if (!org_id || !tier) {
    return NextResponse.redirect(new URL('/settings/billing?error=meta', req.url))
  }

  // Upsert subscription record using service role
  const supabase = createServiceClient()
  await billingService.upsertSubscription(supabase as any, org_id, {
    tier,
    billingPeriod: period ?? 'monthly',
    status: 'active',
    paystackCustomerCode: body.data.customer?.customer_code,
    amountKobo: amount_kobo ?? body.data.amount,
  })

  await billingService.recordInvoice(supabase as any, org_id, {
    paystackReference: reference,
    amountKobo: body.data.amount,
    status: 'paid',
    description: `${tier} plan (${period ?? 'monthly'})`,
    paidAt: new Date().toISOString(),
  })

  return NextResponse.redirect(new URL('/settings/billing?success=1', req.url))
}
