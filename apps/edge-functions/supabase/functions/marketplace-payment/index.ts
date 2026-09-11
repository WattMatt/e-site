/**
 * Edge Function: marketplace-payment
 *
 * Initiates a Paystack payment for a marketplace order.
 * Called from the web app when a contractor is ready to pay.
 *
 * Request body:
 *   {
 *     orderId: string         // UUID of the marketplace.orders row
 *     callbackUrl?: string    // redirect after Paystack checkout
 *     channel?: 'card' | 'bank_transfer' | 'ussd'
 *   }
 *   Authorization: Bearer <user_jwt>
 *
 * Response:
 *   {
 *     authorizationUrl: string   // redirect contractor here
 *     reference: string
 *     commissionKobo: number
 *     supplierKobo: number
 *   }
 *
 * Spec § 7.5, § 8.1  |  CLAUDE.md §3.2 T-039
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'

const PAYSTACK_BASE = 'https://api.paystack.co'
const DEFAULT_COMMISSION_RATE = 0.06

// ─── HMAC helpers ─────────────────────────────────────────────────────────────

/** Generate a unique order payment reference */
function generateReference(orderId: string): string {
  const ts = Date.now().toString(36).toUpperCase()
  const short = orderId.replace(/-/g, '').slice(0, 8).toUpperCase()
  return `ESITE-${short}-${ts}`
}

// ─── Commission calculation ───────────────────────────────────────────────────

function calculateCommission(totalKobo: number, rate: number) {
  const commissionKobo = Math.ceil(totalKobo * rate) // round UP for E-Site
  const supplierKobo = totalKobo - commissionKobo
  return { commissionKobo, supplierKobo }
}

// ─── Paystack API helper ──────────────────────────────────────────────────────

async function paystackPost<T>(
  path: string,
  body: Record<string, unknown>,
  secretKey: string,
): Promise<T> {
  const res = await fetch(`${PAYSTACK_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${secretKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  })

  const json = await res.json() as { status: boolean; message: string; data: T }
  if (!res.ok || !json.status) {
    throw new Error(`Paystack [${res.status}] ${json.message}`)
  }
  return json.data
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export const handler = async (req: Request): Promise<Response> => {
  if (req.method === 'OPTIONS') {
    return new Response(null, {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, content-type',
      },
    })
  }

  if (req.method !== 'POST') {
    return new Response('Method not allowed', { status: 405 })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_ANON_KEY')!,
    { global: { headers: { Authorization: authHeader } } },
  )

  // Verify caller is authenticated
  const { data: { user }, error: authErr } = await supabase.auth.getUser()
  if (authErr || !user) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  let body: { orderId: string; callbackUrl?: string; channel?: string }
  try {
    body = await req.json()
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  const { orderId, callbackUrl, channel } = body
  if (!orderId) {
    return new Response(JSON.stringify({ error: 'orderId is required' }), {
      status: 400,
      headers: { 'Content-Type': 'application/json' },
    })
  }

  try {
    // 1. Load order — RLS ensures user can only pay orders belonging to their org
    const { data: order, error: orderErr } = await supabase
      .schema('marketplace')
      .from('orders')
      .select(`
        id, contractor_org_id, supplier_id, total_amount, payment_status,
        commission_rate, paystack_split_code, notes,
        created_by_profile:profiles!created_by(id, email, full_name)
      `)
      .eq('id', orderId)
      .single()

    if (orderErr || !order) {
      return new Response(JSON.stringify({ error: 'Order not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (order.payment_status === 'paid') {
      return new Response(JSON.stringify({ error: 'Order is already paid' }), {
        status: 409,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    if (!order.total_amount || order.total_amount <= 0) {
      return new Response(JSON.stringify({ error: 'Order has no total amount' }), {
        status: 422,
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // 2. Determine commission rate (order-level override or supplier default)
    const commissionRate = order.commission_rate
      ? Number(order.commission_rate)
      : DEFAULT_COMMISSION_RATE

    const totalKobo = Math.round(Number(order.total_amount) * 100) // ZAR → kobo
    const { commissionKobo, supplierKobo } = calculateCommission(totalKobo, commissionRate)

    // 3. Get or create Paystack split code for this supplier
    let splitCode = order.paystack_split_code as string | null

    if (!splitCode) {
      // Look up the supplier's subaccount
      const serviceSupabase = createClient(
        Deno.env.get('SUPABASE_URL')!,
        Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
      )

      // NOTE: percentage_charge is deliberately NOT read here. It was selected
      // and never used, which reads as if the supplier's stored share governs
      // the split when in fact `commissionRate` does. The two disagree in the
      // schema (migration 00016 defaults percentage_charge to 6.00 under a
      // comment calling it the E-Site commission %, while the subaccount route
      // writes 94) and reconciling them is a separate commercial decision —
      // see the 2026-09 payments audit, rank 11. Do not wire it in here.
      const { data: sub } = await serviceSupabase
        .schema('marketplace')
        .from('paystack_subaccounts')
        .select('subaccount_code, split_code')
        .eq('supplier_id', order.supplier_id)
        .maybeSingle()

      if (sub?.split_code) {
        splitCode = sub.split_code
      } else if (sub?.subaccount_code) {
        // Create split on-the-fly if missing
        const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')!
        const supplierSharePercent = Math.floor((1 - commissionRate) * 100)

        const splitData = await paystackPost<{ split_code: string }>(
          '/split',
          {
            name: `Supplier ${order.supplier_id} split`,
            type: 'percentage',
            currency: 'ZAR',
            subaccounts: [{ subaccount: sub.subaccount_code, share: supplierSharePercent }],
            // The SUPPLIER bears the Paystack transaction fee — live Terms of
            // Service 4.2, and what the KYC pack declares. 'all' shares the fee
            // across every account in the split INCLUDING the payout account,
            // which made E-Site absorb roughly half of every fee (~3% of its own
            // commission). Paystack requires bearer_subaccount to be named
            // whenever bearer_type is 'subaccount'.
            bearer_type: 'subaccount',
            bearer_subaccount: sub.subaccount_code,
          },
          paystackKey,
        )

        splitCode = splitData.split_code

        // Persist the split code
        await serviceSupabase
          .schema('marketplace')
          .from('paystack_subaccounts')
          .update({ split_code: splitCode })
          .eq('supplier_id', order.supplier_id)
      }
    }

    // A charge with no split settles 100% into E-Site's account while the code
    // below still stamps commission_rate/commission_amount on the order and the
    // supplier's order page still promises them 94% "on settlement". Refuse
    // instead: a supplier who has not completed payout onboarding must not be
    // transacted against at all.
    if (!splitCode) {
      return new Response(
        JSON.stringify({
          error: 'This supplier has not completed payout onboarding, so the order cannot be paid yet.',
        }),
        { status: 422, headers: { 'Content-Type': 'application/json' } },
      )
    }

    // 4. Generate unique reference
    const reference = generateReference(orderId)

    // 5. Initialize Paystack transaction
    const paystackKey = Deno.env.get('PAYSTACK_SECRET_KEY')!
    const callerProfile = (order as any).created_by_profile as { email: string } | null
    const payerEmail = callerProfile?.email ?? user.email ?? 'contractor@esite.co.za'

    const txPayload: Record<string, unknown> = {
      amount: totalKobo,
      email: payerEmail,
      reference,
      currency: 'ZAR',
      metadata: {
        order_id: orderId,
        commission_rate: commissionRate,
        source: 'esite-marketplace',
        custom_fields: [
          { display_name: 'Order ID', variable_name: 'order_id', value: orderId },
          {
            display_name: 'Commission',
            variable_name: 'commission_kobo',
            value: commissionKobo,
          },
        ],
      },
    }

    // Unconditional: the guard above already refused a null splitCode. Never
    // re-introduce an `if` here — it is how a split-less full-value capture
    // shipped in the first place.
    txPayload.split_code = splitCode

    if (callbackUrl) {
      txPayload.callback_url = callbackUrl
    }

    if (channel) {
      txPayload.channels = [channel]
    }

    const txData = await paystackPost<{
      authorization_url: string
      access_code: string
      reference: string
    }>('/transaction/initialize', txPayload, paystackKey)

    // 6. Persist reference on the order so we can verify it later
    const serviceSupabase2 = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    )
    await serviceSupabase2
      .schema('marketplace')
      .from('orders')
      .update({
        paystack_reference: reference,
        paystack_split_code: splitCode,
        commission_rate: commissionRate,
        commission_amount: commissionKobo / 100,
        payment_status: 'pending',
      })
      .eq('id', orderId)

    return new Response(
      JSON.stringify({
        authorizationUrl: txData.authorization_url,
        accessCode: txData.access_code,
        reference: txData.reference,
        totalKobo,
        commissionKobo,
        supplierKobo,
      }),
      { headers: { 'Content-Type': 'application/json' } },
    )
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err)
    console.error('marketplace-payment error:', message)
    return new Response(JSON.stringify({ error: message }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    })
  }
}

Deno.serve(handler)
