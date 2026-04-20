/**
 * Edge Function: eft-invoice
 *
 * For Enterprise clients preferring bank transfer (EFT).
 * Generates a Paystack payment link, persists an invoice as 'pending_eft',
 * and notifies the admin. Subscription is activated when admin calls
 * POST /eft-invoice with action=confirm and the invoice ID.
 *
 * POST body (generate):
 *   { organisationId, tier, billingPeriod }
 *   Authorization: Bearer <service_role_key>
 *
 * POST body (confirm):
 *   { action: 'confirm', invoiceId }
 *   Authorization: Bearer <service_role_key>
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'
import { requireServiceRole } from '../_shared/auth.ts'

const PAYSTACK_SECRET = Deno.env.get('PAYSTACK_SECRET_KEY') ?? ''
const PAYSTACK_INIT_URL = 'https://api.paystack.co/transaction/initialize'

const PLAN_AMOUNTS: Record<string, Record<string, number>> = {
  enterprise: { monthly: 500000_00, annual: 5000000_00 }, // R5,000/mo or R50,000/yr (custom)
  professional: { monthly: 1499_00, annual: 14990_00 },
  starter: { monthly: 499_00, annual: 4990_00 },
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', {
      headers: {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
      },
    })
  }

  const authHeader = req.headers.get('Authorization')
  if (!authHeader) {
    return new Response(JSON.stringify({ error: 'Unauthorized' }), {
      status: 401, headers: { 'Content-Type': 'application/json' },
    })
  }
  const unauth = requireServiceRole(req)
  if (unauth) return unauth

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  )

  try {
    const body = await req.json()

    // --- CONFIRM EFT (admin marks payment received) ---
    if (body.action === 'confirm') {
      const { invoiceId } = body as { invoiceId: string }
      if (!invoiceId) {
        return new Response(JSON.stringify({ error: 'invoiceId required' }), {
          status: 400, headers: { 'Content-Type': 'application/json' },
        })
      }

      // Fetch the invoice
      const { data: invoice, error: invErr } = await supabase
        .schema('billing')
        .from('invoices')
        .select('*')
        .eq('id', invoiceId)
        .single()

      if (invErr || !invoice) {
        return new Response(JSON.stringify({ error: 'Invoice not found' }), {
          status: 404, headers: { 'Content-Type': 'application/json' },
        })
      }

      // Mark invoice paid
      await supabase
        .schema('billing')
        .from('invoices')
        .update({ status: 'paid', paid_at: new Date().toISOString() })
        .eq('id', invoiceId)

      // Activate subscription
      const meta = (invoice as any).metadata ?? {}
      const nextBilling = new Date()
      if (meta.billing_period === 'annual') {
        nextBilling.setFullYear(nextBilling.getFullYear() + 1)
      } else {
        nextBilling.setMonth(nextBilling.getMonth() + 1)
      }

      await supabase
        .schema('billing')
        .from('subscriptions')
        .upsert({
          organisation_id: invoice.organisation_id,
          tier: meta.tier ?? 'enterprise',
          billing_period: meta.billing_period ?? 'annual',
          status: 'active',
          amount_kobo: invoice.amount_kobo,
          next_billing_date: nextBilling.toISOString().split('T')[0],
        }, { onConflict: 'organisation_id' })

      console.log(`EFT confirmed for invoice ${invoiceId}, org ${invoice.organisation_id}`)
      return new Response(JSON.stringify({ confirmed: true }), {
        headers: { 'Content-Type': 'application/json' },
      })
    }

    // --- GENERATE EFT INVOICE ---
    const { organisationId, tier, billingPeriod } = body as {
      organisationId: string
      tier: string
      billingPeriod: 'monthly' | 'annual'
    }

    if (!organisationId || !tier) {
      return new Response(JSON.stringify({ error: 'organisationId and tier required' }), {
        status: 400, headers: { 'Content-Type': 'application/json' },
      })
    }

    const period = billingPeriod === 'annual' ? 'annual' : 'monthly'
    const amountKobo = PLAN_AMOUNTS[tier]?.[period] ?? PLAN_AMOUNTS.enterprise[period]

    // Get organisation + admin email
    const { data: org } = await supabase
      .from('organisations')
      .select('name')
      .eq('id', organisationId)
      .single()

    const { data: admin } = await supabase
      .from('user_organisations')
      .select('user:profiles!user_id(email, full_name)')
      .eq('organisation_id', organisationId)
      .in('role', ['admin', 'owner'])
      .eq('is_active', true)
      .limit(1)
      .single()

    const adminEmail = (admin?.user as any)?.email
    const adminName = (admin?.user as any)?.full_name ?? org?.name ?? 'Client'

    // Generate Paystack payment link (if key available)
    let paymentUrl: string | null = null
    const reference = `eft-${organisationId.slice(0, 8)}-${Date.now()}`

    if (PAYSTACK_SECRET && adminEmail) {
      const paystackRes = await fetch(PAYSTACK_INIT_URL, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${PAYSTACK_SECRET}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: adminEmail,
          amount: amountKobo,
          reference,
          currency: 'ZAR',
          metadata: {
            organisation_id: organisationId,
            tier,
            billing_period: period,
            payment_type: 'eft_invoice',
          },
        }),
      })
      const paystackData = await paystackRes.json()
      if (paystackData.status) {
        paymentUrl = paystackData.data?.authorization_url ?? null
      }
    }

    // Persist invoice as pending_eft
    const { data: invoice, error: insertErr } = await supabase
      .schema('billing')
      .from('invoices')
      .insert({
        organisation_id: organisationId,
        paystack_reference: reference,
        amount_kobo: amountKobo,
        status: 'pending_eft',
        description: `E-Site ${tier.charAt(0).toUpperCase() + tier.slice(1)} Plan — ${period === 'annual' ? 'Annual' : 'Monthly'} subscription`,
        metadata: { tier, billing_period: period, payment_url: paymentUrl },
      })
      .select()
      .single()

    if (insertErr) throw insertErr

    // Notify via in-app notification
    if (admin) {
      const adminUserId = await supabase
        .from('user_organisations')
        .select('user_id')
        .eq('organisation_id', organisationId)
        .in('role', ['admin', 'owner'])
        .eq('is_active', true)
        .limit(1)
        .single()
        .then(r => r.data?.user_id)

      if (adminUserId) {
        await supabase
          .from('notifications')
          .insert({
            user_id: adminUserId,
            title: 'EFT Invoice Generated',
            body: `Your E-Site ${tier} subscription invoice is ready. Pay via EFT to activate.`,
            data: { route: '/settings/billing', payment_url: paymentUrl ?? '' },
          })
          .catch((e: any) => console.error('Notification insert failed:', e))
      }
    }

    console.log(`EFT invoice generated: ${invoice.id} for org ${organisationId} (${tier}/${period})`)
    return new Response(JSON.stringify({
      invoiceId: invoice.id,
      reference,
      amountKobo,
      amountZAR: (amountKobo / 100).toFixed(2),
      paymentUrl,
      status: 'pending_eft',
    }), {
      headers: { 'Content-Type': 'application/json' },
    })
  } catch (err: any) {
    console.error('eft-invoice error:', err)
    return new Response(JSON.stringify({ error: err.message }), {
      status: 500, headers: { 'Content-Type': 'application/json' },
    })
  }
})
