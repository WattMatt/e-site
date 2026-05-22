import type { TypedSupabaseClient } from '@esite/db'

// PLANS — single source of truth for tier pricing + Paystack plan-code lookup.
//
// Plan codes are NOT hardcoded; they're discovered at runtime from env vars
// (created on Paystack dashboard per docs/paystack-go-live-roadmap.md §3).
// When the env var is unset (e.g. test mode pre-plan-creation), the checkout
// route falls back to one-off transaction mode. This means:
//   - test mode today (no env vars set) → one-off charge, no recurring
//   - test mode after creating test plans → recurring against test plans
//   - live mode after creating live plans → recurring against live plans
// Free + Enterprise have no Paystack flow (free has nothing to charge,
// enterprise short-circuits to mailto:sales in the checkout route).
export const PLANS = {
  free: {
    tier: 'free',
    name: 'Free',
    monthlyKobo: 0,
    annualKobo: 0,
    monthlyPlanCodeEnv: null,
    annualPlanCodeEnv: null,
    features: ['1 project', '5 users', 'Basic snag tracking', 'RFI management'],
    limits: { projects: 1, users: 5 },
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    monthlyKobo: 49900, // R499/mo
    annualKobo: 499000, // R4,990/yr (2 months free)
    monthlyPlanCodeEnv: 'PAYSTACK_PLAN_STARTER_MONTHLY',
    annualPlanCodeEnv: 'PAYSTACK_PLAN_STARTER_ANNUAL',
    features: ['5 projects', '10 users', 'COC tracking', 'Floor plans', 'Priority email support'],
    limits: { projects: 5, users: 10 },
  },
  professional: {
    tier: 'professional',
    name: 'Professional',
    monthlyKobo: 149900, // R1,499/mo
    annualKobo: 1499000, // R14,990/yr
    monthlyPlanCodeEnv: 'PAYSTACK_PLAN_PROFESSIONAL_MONTHLY',
    annualPlanCodeEnv: 'PAYSTACK_PLAN_PROFESSIONAL_ANNUAL',
    features: ['Unlimited projects', '30 users', 'Marketplace access', 'API access', 'Phone support'],
    limits: { projects: -1, users: 30 },
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    monthlyKobo: 0, // Custom
    annualKobo: 0,
    monthlyPlanCodeEnv: null,
    annualPlanCodeEnv: null,
    features: ['Custom limits', 'White label', 'Dedicated CSM', 'SLA guarantee', 'Custom integrations'],
    limits: { projects: -1, users: -1 },
  },
} as const

export type PlanTier = keyof typeof PLANS

/**
 * Resolve the Paystack plan code for a (tier, period) pair from env vars at
 * runtime. Returns undefined when unset — callers should fall back to one-off
 * `transaction/initialize` with `amount`. When set, callers should pass `plan`
 * to Paystack and Paystack will auto-create a customer + recurring subscription.
 *
 * Env var names (set in Vercel after creating plans on Paystack dashboard):
 *   PAYSTACK_PLAN_STARTER_MONTHLY       (PLN_…)
 *   PAYSTACK_PLAN_STARTER_ANNUAL        (PLN_…)
 *   PAYSTACK_PLAN_PROFESSIONAL_MONTHLY  (PLN_…)
 *   PAYSTACK_PLAN_PROFESSIONAL_ANNUAL   (PLN_…)
 */
export function resolvePaystackPlanCode(
  tier: PlanTier,
  period: 'monthly' | 'annual',
  env: Record<string, string | undefined> = (typeof process !== 'undefined' ? process.env : {}) as Record<string, string | undefined>,
): string | undefined {
  const plan = PLANS[tier]
  if (!plan) return undefined
  const envName = period === 'monthly' ? plan.monthlyPlanCodeEnv : plan.annualPlanCodeEnv
  if (!envName) return undefined
  const value = env[envName]?.trim()
  return value && value.length > 0 ? value : undefined
}

export const billingService = {
  async getSubscription(client: TypedSupabaseClient, orgId: string) {
    const { data } = await client
      .schema('billing')
      .from('subscriptions')
      .select('*')
      .eq('organisation_id', orgId)
      .single()
    return data
  },

  async getInvoices(client: TypedSupabaseClient, orgId: string) {
    const { data, error } = await client
      .schema('billing')
      .from('invoices')
      .select('*')
      .eq('organisation_id', orgId)
      .order('created_at', { ascending: false })
      .limit(12)
    if (error) throw error
    return data ?? []
  },

  async upsertSubscription(client: TypedSupabaseClient, orgId: string, params: {
    tier: string
    billingPeriod: string
    status: string
    paystackSubscriptionCode?: string
    paystackPlanCode?: string
    paystackCustomerCode?: string
    amountKobo: number
    nextBillingDate?: string
  }) {
    const { data, error } = await client
      .schema('billing')
      .from('subscriptions')
      .upsert({
        organisation_id: orgId,
        tier: params.tier,
        billing_period: params.billingPeriod,
        status: params.status,
        paystack_subscription_code: params.paystackSubscriptionCode,
        paystack_plan_code: params.paystackPlanCode,
        paystack_customer_code: params.paystackCustomerCode,
        amount_kobo: params.amountKobo,
        next_billing_date: params.nextBillingDate,
      }, { onConflict: 'organisation_id' })
      .select()
      .single()
    if (error) throw error
    return data
  },

  async recordInvoice(client: TypedSupabaseClient, orgId: string, params: {
    paystackReference: string
    amountKobo: number
    status: string
    description?: string
    paidAt?: string
  }) {
    // Idempotent on paystack_reference: a duplicate webhook delivery, or the
    // callback and webhook both recording the same charge, is a clean no-op.
    const { data, error } = await client
      .schema('billing')
      .from('invoices')
      .upsert({
        organisation_id: orgId,
        paystack_reference: params.paystackReference,
        amount_kobo: params.amountKobo,
        status: params.status,
        description: params.description,
        paid_at: params.paidAt,
      }, { onConflict: 'paystack_reference', ignoreDuplicates: true })
      .select()
      .maybeSingle()
    if (error) throw error
    return data
  },
}
