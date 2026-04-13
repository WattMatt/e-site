import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, type PlanTier } from '@esite/shared'

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  const { tier, period } = await req.json() as { tier: PlanTier; period: 'monthly' | 'annual' }

  const plan = PLANS[tier]
  if (!plan || tier === 'free') {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const amountKobo = period === 'annual' ? plan.annualKobo : plan.monthlyKobo
  if (amountKobo === 0 && tier === 'enterprise') {
    // Enterprise: redirect to contact
    return NextResponse.json({ contactSales: true })
  }

  // Get user's org
  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!mem) return NextResponse.json({ error: 'No organisation found' }, { status: 400 })

  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/callback`

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      email: user.email,
      amount: amountKobo, // in kobo
      currency: 'ZAR',
      callback_url: callbackUrl,
      metadata: {
        org_id: mem.organisation_id,
        tier,
        period,
        amount_kobo: amountKobo,
        cancel_action: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing`,
      },
    }),
  })

  const body = await response.json()
  if (!body.status) {
    return NextResponse.json({ error: body.message ?? 'Paystack error' }, { status: 502 })
  }

  return NextResponse.json({ authorization_url: body.data.authorization_url })
}
