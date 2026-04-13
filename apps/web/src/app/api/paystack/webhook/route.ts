import { NextRequest, NextResponse } from 'next/server'
import { createHmac } from 'crypto'
import { createServiceClient } from '@/lib/supabase/server'
import { billingService } from '@esite/shared'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY ?? ''

export async function POST(req: NextRequest) {
  // Verify Paystack signature
  const signature = req.headers.get('x-paystack-signature')
  const rawBody = await req.text()
  const hash = createHmac('sha512', PAYSTACK_SECRET).update(rawBody).digest('hex')
  if (hash !== signature) {
    return NextResponse.json({ error: 'Invalid signature' }, { status: 401 })
  }

  const event = JSON.parse(rawBody)
  const supabase = await createServiceClient()

  if (event.event === 'charge.success') {
    const data = event.data
    const { org_id, tier, period, amount_kobo } = data.metadata ?? {}
    if (org_id && tier) {
      await billingService.upsertSubscription(supabase as any, org_id, {
        tier,
        billingPeriod: period ?? 'monthly',
        status: 'active',
        paystackCustomerCode: data.customer?.customer_code,
        amountKobo: amount_kobo ?? data.amount,
      }).catch(console.error)

      await billingService.recordInvoice(supabase as any, org_id, {
        paystackReference: data.reference,
        amountKobo: data.amount,
        status: 'paid',
        description: `${tier} plan charge`,
        paidAt: new Date().toISOString(),
      }).catch(console.error)
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

  if (event.event === 'invoice.payment_failed') {
    const inv = event.data
    const { error } = await supabase
      .schema('billing')
      .from('subscriptions')
      .update({ status: 'past_due' })
      .eq('paystack_subscription_code', inv.subscription?.subscription_code)
    if (error) console.error('Webhook past_due error:', error)
  }

  return NextResponse.json({ received: true })
}
