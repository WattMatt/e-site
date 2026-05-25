import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { OWNER_ADMIN, PLANS, resolvePaystackPlanCode } from '@esite/shared'
import { requireRoleAPI } from '@/lib/auth/require-role'
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

  // Only owners and admins may initiate a subscription checkout — Paystack
  // billing is an org-level commitment, not something contractors/suppliers/
  // inspectors should be able to trigger on the org's behalf.
  const guard = await requireRoleAPI(OWNER_ADMIN)
  if (!guard.ok) return guard.response
  const { userId, organisationId } = guard.ctx
  const userEmail = guard.user.email

  if (!rateLimit(`checkout:${userId}`, 5, 60_000)) {
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

  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/callback`

  // Path B: when PAYSTACK_PLAN_<TIER>_<PERIOD> env is set, send `plan` field.
  // Paystack auto-creates a customer + recurring subscription. Without env
  // var, fall back to one-off `amount` (the legacy / pre-go-live behaviour).
  // See packages/shared/src/services/billing.service.ts resolvePaystackPlanCode.
  const planCode = resolvePaystackPlanCode(tier as 'starter' | 'professional', period)
  const isRecurring = !!planCode

  const initBody: Record<string, unknown> = {
    email: userEmail,
    currency: 'ZAR',
    callback_url: callbackUrl,
    metadata: {
      org_id: organisationId,
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
