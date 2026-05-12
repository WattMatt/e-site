import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { PLANS, resolvePaystackPlanCode } from '@esite/shared'
import { rateLimit } from '@/lib/rate-limit'

const bodySchema = z.object({
  tier: z.enum(['starter', 'professional', 'enterprise']),
  period: z.enum(['monthly', 'annual']),
})

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`checkout:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { tier, period } = parsed.data

  const plan = PLANS[tier]
  if (!plan) {
    return NextResponse.json({ error: 'Invalid plan' }, { status: 400 })
  }

  const amountKobo = period === 'annual' ? plan.annualKobo : plan.monthlyKobo
  if (amountKobo === 0 && tier === 'enterprise') {
    // Enterprise: redirect to contact
    return NextResponse.json({ contactSales: true })
  }

  // Get user's org
  const { data: memRaw } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  const mem = memRaw as { organisation_id: string } | null

  if (!mem) return NextResponse.json({ error: 'No organisation found' }, { status: 400 })

  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/callback`

  // Path B: when PAYSTACK_PLAN_<TIER>_<PERIOD> env is set, send `plan` field.
  // Paystack auto-creates a customer + recurring subscription. Without env
  // var, fall back to one-off `amount` (the legacy / pre-go-live behaviour).
  // See packages/shared/src/services/billing.service.ts resolvePaystackPlanCode.
  const planCode = resolvePaystackPlanCode(tier as 'starter' | 'professional', period)
  const isRecurring = !!planCode

  const initBody: Record<string, unknown> = {
    email: user.email,
    currency: 'ZAR',
    callback_url: callbackUrl,
    metadata: {
      org_id: mem.organisation_id,
      tier,
      period,
      amount_kobo: amountKobo,
      plan_code: planCode ?? null, // captured so the callback knows which mode it was
      mode: isRecurring ? 'recurring' : 'one_off',
      cancel_action: `${process.env.NEXT_PUBLIC_SITE_URL}/settings/billing`,
    },
  }
  if (isRecurring) {
    initBody.plan = planCode
    // When `plan` is set, Paystack uses the plan's amount + interval.
    // Sending `amount` alongside is allowed (must match) but redundant.
  } else {
    initBody.amount = amountKobo
  }

  const response = await fetch('https://api.paystack.co/transaction/initialize', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${PAYSTACK_SECRET}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(initBody),
  })

  const body = await response.json()
  if (!body.status) {
    return NextResponse.json({ error: body.message ?? 'Paystack error' }, { status: 502 })
  }

  return NextResponse.json({ authorization_url: body.data.authorization_url })
}
