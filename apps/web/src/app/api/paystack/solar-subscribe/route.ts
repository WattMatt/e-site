import { NextRequest, NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { OWNER_ADMIN } from '@esite/shared'
import { requireRole } from '@/lib/auth/require-role'
import { orgHasSolar } from '@/lib/solar/access'
import { rateLimit } from '@/lib/rate-limit'
import { solarLockedPath, solarReturnTo } from '@/lib/paystack/return-to'
import { ORG_ADDON_METADATA_TYPE, solarPlanCode } from '@/lib/paystack/org-addon'
import { solarSubscribeBodySchema } from '@/lib/paystack/solar-subscribe-body'

// Starts the ORG-wide Solar subscription (decision D-01: R1,999/yr excl. VAT,
// every project of the org) against the PAYSTACK_PLAN_SOLAR_ANNUAL recurring
// plan. Spec: docs/solar/03-data-model-and-security.md §2.3 point 4.
//
// WRITES NOTHING. Unlike /api/paystack/mv-subscribe there is no disclaimer to
// record, and a 'pending' row would make this route a second writer of
// billing.org_addon_subscriptions — the shape that once downgraded an active
// MV subscriber to 'pending' (see mv-subscribe/route.ts). The webhook
// (metadata.type === 'org_addon_subscription') inserts the row on the first
// successful charge and is the only writer thereafter.
//
// The ORG comes from the PROJECT, not from the caller's primary org: an owner
// of several orgs buys for the org that owns the project they are looking at.
// requireRole (the primitive) against that org — org-wide billing surfaces use
// requireRole, never requireEffectiveRole (see lib/auth/require-role.ts).
//
// OWNER ACTION REQUIRED: 503 until PAYSTACK_PLAN_SOLAR_ANNUAL holds a PLN_…
// code for an annual ZAR plan created on the Paystack dashboard.

// Shared with the Solar SubscribeButton so the sender and the parser cannot drift.
const bodySchema = solarSubscribeBodySchema

const PAYSTACK_SECRET = process.env.PAYSTACK_SECRET_KEY

/** One body for "no such project" and "not owner/admin of its org" — no existence oracle. */
const FORBIDDEN = {
  error: "Only an owner or admin of this project's organisation can subscribe to Solar",
}

export async function POST(req: NextRequest) {
  if (!PAYSTACK_SECRET) {
    return NextResponse.json({ error: 'Paystack not configured' }, { status: 503 })
  }

  // Plan-based only — there is no one-off fallback. Without a plan there is
  // nothing to subscribe the org to.
  const planCode = solarPlanCode()
  if (!planCode) {
    return NextResponse.json({ error: 'Solar subscription plan not configured' }, { status: 503 })
  }

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })

  if (!rateLimit(`solar-subscribe:${user.id}`, 5, 60_000)) {
    return NextResponse.json({ error: 'Too many requests. Please try again shortly.' }, { status: 429 })
  }

  let raw: unknown
  try {
    raw = await req.json()
  } catch {
    raw = null
  }
  const parsed = bodySchema.safeParse(raw)
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request body' }, { status: 400 })
  }
  const projectId = parsed.data.project_id

  // Through the CALLER's session: a project they cannot see is refused here.
  const { data: project } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('id, organisation_id')
    .eq('id', projectId)
    .maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  if (!orgId) return NextResponse.json(FORBIDDEN, { status: 403 })

  const guard = await requireRole(supabase as any, orgId, OWNER_ADMIN)
  if (!guard.ok) return NextResponse.json(FORBIDDEN, { status: 403 })

  // org_has_solar answers truthfully for an active member of the org, which
  // the gate above has just established. It fails closed (false) on an RPC
  // error, so a transient error lets the purchase proceed — the webhook's
  // duplicate-purchase handling is the backstop for that case.
  if (await orgHasSolar(orgId, supabase as any)) {
    return NextResponse.json(
      { error: 'Solar is already active for this organisation', alreadySubscribed: true },
      { status: 409 },
    )
  }

  // Paystack cannot initialise a transaction without an email address.
  if (!user.email) {
    return NextResponse.json({ error: 'Your account has no email address to bill' }, { status: 400 })
  }

  const site = process.env.NEXT_PUBLIC_SITE_URL
  // Owner default (Phase 1B): the payer returns to the project's Solar LOCKED
  // page flagged payment=received — it renders outside the gated group, so it
  // can show "activating Solar…" while the webhook lands. A cancelled
  // checkout returns to the same page WITHOUT the flag.
  const returnTo = solarReturnTo(projectId)
  const initBody = {
    email: user.email,
    currency: 'ZAR',
    plan: planCode,
    callback_url: `${site}/api/paystack/callback`,
    metadata: {
      type: ORG_ADDON_METADATA_TYPE,
      feature_key: 'solar' as const,
      org_id: orgId,
      project_id: projectId,
      user_id: user.id,
      return_to: returnTo,
      cancel_action: `${site}${solarLockedPath(projectId)}`,
    },
  }

  let body: { status?: boolean; message?: string; data?: { authorization_url?: string } }
  try {
    const response = await fetch('https://api.paystack.co/transaction/initialize', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${PAYSTACK_SECRET}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initBody),
    })
    body = await response.json()
  } catch (err) {
    console.error('solar-subscribe: Paystack initialize failed:', err)
    return NextResponse.json({ error: 'Could not reach Paystack. Please try again.' }, { status: 502 })
  }
  if (!body.status) {
    return NextResponse.json({ error: body.message ?? 'Paystack error' }, { status: 502 })
  }

  return NextResponse.json({ authorization_url: body.data?.authorization_url })
}
