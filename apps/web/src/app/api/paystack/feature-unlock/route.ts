import { z } from 'zod'
import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { FEATURE_PRICES, type FeatureKey } from '@esite/shared'
import { hasFeature } from '@/lib/features'
import { rateLimit } from '@/lib/rate-limit'

// Initialises a one-time Paystack charge to unlock a paid add-on feature for
// the caller's organisation. The webhook handler at /api/paystack/webhook
// (matched on metadata.type === 'feature_unlock') is what actually writes
// the unlock row into billing.org_feature_unlocks — this route only kicks
// off the hosted-page redirect.

const bodySchema = z.object({
  feature_key: z.enum(Object.keys(FEATURE_PRICES) as [FeatureKey, ...FeatureKey[]]),
})

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`feature-unlock:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  const parsed = bodySchema.safeParse(await req.json())
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const { feature_key } = parsed.data

  // Resolve caller's org — owner/admin only, to match the paywall CTA gating.
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .in('role', ['owner', 'admin'])
    .order('created_at')
    .limit(1)
    .maybeSingle()
  const mem = membership as { organisation_id: string; role: string } | null
  if (!mem) {
    return NextResponse.json(
      { error: 'Only an organisation owner or admin can unlock paid features' },
      { status: 403 },
    )
  }

  // Already unlocked → 409. Stops the user paying twice for the same feature.
  const already = await hasFeature(mem.organisation_id, feature_key, supabase)
  if (already) {
    return NextResponse.json(
      { error: 'This feature is already unlocked for your organisation', alreadyUnlocked: true },
      { status: 409 },
    )
  }

  const price = FEATURE_PRICES[feature_key]
  const callbackUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/api/paystack/callback`

  const initBody = {
    email: user.email,
    amount: price.amountKobo,
    currency: 'ZAR',
    callback_url: callbackUrl,
    metadata: {
      type: 'feature_unlock' as const,
      feature_key,
      org_id: mem.organisation_id,
      amount_kobo: price.amountKobo,
      cancel_action: `${process.env.NEXT_PUBLIC_SITE_URL}/inspections/unlock`,
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
