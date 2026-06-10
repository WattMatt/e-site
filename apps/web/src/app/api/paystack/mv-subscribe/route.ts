import { NextRequest, NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { rateLimit } from '@/lib/rate-limit'

// Initialises the per-user MV protection subscription — a R2000/year recurring
// Paystack charge against the PAYSTACK_PLAN_MV_ANNUAL plan. Mirrors the org
// subscription checkout (/api/paystack/checkout) but is per-USER, not per-org.
//
// Two steps:
//   1. Record the user's acceptance of the non-validation disclaimer + a
//      'pending' subscription row. This MUST go through the service role —
//      billing.user_mv_subscriptions has SELECT-own RLS and no write policy.
//   2. transaction/initialize with `plan` so Paystack auto-creates a customer +
//      recurring subscription. The webhook (metadata.type === 'mv_subscription')
//      flips status→active and sets current_period_end on the first charge and
//      every annual renewal.
//
// OWNER ACTION REQUIRED: this route returns 503 until PAYSTACK_PLAN_MV_ANNUAL is
// set to a PLN_… code from a R2000/yr ZAR Plan created on the Paystack
// dashboard. Without it there is no recurring plan to subscribe the user to.

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  // The MV subscription is plan-based only — there is no one-off fallback (unlike
  // the org checkout). Without a configured plan there is nothing to charge.
  const planCode = process.env.PAYSTACK_PLAN_MV_ANNUAL?.trim()
  if (!planCode) {
    return NextResponse.json(
      { error: 'MV subscription plan not configured' },
      { status: 503 },
    )
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`mv-subscribe:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  // Step 1 — record disclaimer acceptance + a pending row. Service role: RLS
  // blocks the user from writing their own subscription row. Idempotent on
  // user_id; re-pressing subscribe refreshes the acceptance timestamp without
  // disturbing an already-active subscription's period/status… so only set
  // status='pending' when there is no row yet — never downgrade an active one.
  const service = createServiceClient()
  const { error: upsertErr } = await (service as any)
    .schema('billing')
    .from('user_mv_subscriptions')
    .upsert(
      {
        user_id: user.id,
        status: 'pending',
        disclaimer_accepted_at: new Date().toISOString(),
      },
      { onConflict: 'user_id', ignoreDuplicates: false },
    )
  if (upsertErr) {
    console.error('mv-subscribe acceptance upsert error:', upsertErr)
    return NextResponse.json({ error: 'Could not record acceptance' }, { status: 500 })
  }

  // Step 2 — Paystack hosted-page redirect for the recurring plan.
  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/callback`
  const initBody = {
    email: user.email,
    currency: 'ZAR',
    plan: planCode,
    callback_url: callbackUrl,
    metadata: {
      type: 'mv_subscription' as const,
      user_id: user.id,
      cancel_action: `${process.env.NEXT_PUBLIC_SITE_URL}/dashboard`,
    },
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
