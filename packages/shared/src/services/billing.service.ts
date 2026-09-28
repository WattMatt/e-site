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

// FEATURE_PRICES — single source of truth for paid add-ons. Lives alongside
// PLANS but operates orthogonally to the subscription tier.
//
// model: 'org'              — one-time unlock per organisation (billing.org_feature_unlocks, migration 00097)
// model: 'seat'             — one-time unlock per user within an org (billing.org_feature_seats, migration 00125)
// model: 'org_subscription' — RECURRING org-wide plan (billing.org_addon_subscriptions, migration 00207).
//                             Bought only through its own route (/api/paystack/solar-subscribe) against
//                             the Paystack plan named by `planCodeEnv`. NEVER through the one-time
//                             /api/paystack/feature-unlock route, which rejects these keys: a one-time
//                             R1,999 charge there would grant nothing (no webhook branch writes an
//                             org_feature_unlocks row for a subscription key) while taking the money.
//
// Webhook flow lives in /api/paystack/webhook under metadata.type ===
// 'feature_unlock' | 'feature_seat' | 'org_addon_subscription'.
export const FEATURE_PRICES = {
  inspections: {
    key: 'inspections',
    label: 'Inspections module',
    amountKobo: 25000, // R250 lifetime
    description: 'All current and future inspection templates, lifetime access.',
    model: 'org' as const,
  },
  jbcc: {
    key: 'jbcc',
    label: 'JBCC Procedural Toolkit',
    amountKobo: 199900, // R1,999 lifetime
    description: 'JBCC Procedural Toolkit — clause reference, notice-letter generation, time-bar tracking',
    model: 'org' as const,
  },
  generator_cost_recovery: {
    key: 'generator_cost_recovery',
    label: 'Generator Cost-Recovery',
    amountKobo: 200000,
    description: 'Standby-generator cost-recovery: tenant apportionment + branded report. Per-user seat.',
    model: 'seat' as const,
  },
  solar: {
    key: 'solar',
    label: 'Solar module',
    amountKobo: 199900, // R1,999 per year excl. VAT (decision D-01)
    description: 'Solar design, simulation and client proposals on every project of your organisation. Annual subscription.',
    model: 'org_subscription' as const,
    interval: 'annual' as const,
    planCodeEnv: 'PAYSTACK_PLAN_SOLAR_ANNUAL',
  },
} as const

export type FeatureKey = keyof typeof FEATURE_PRICES

/** Keys sold as a recurring subscription rather than a one-time unlock. */
export type SubscriptionFeatureKey = {
  [K in FeatureKey]: (typeof FEATURE_PRICES)[K]['model'] extends 'org_subscription' ? K : never
}[FeatureKey]

/** Keys sold as a one-time charge — the only keys /api/paystack/feature-unlock may accept. */
export type OneTimeFeatureKey = Exclude<FeatureKey, SubscriptionFeatureKey>

export function isSubscriptionFeature(key: string): key is SubscriptionFeatureKey {
  if (!Object.prototype.hasOwnProperty.call(FEATURE_PRICES, key)) return false
  return FEATURE_PRICES[key as FeatureKey].model === 'org_subscription'
}

export const ONE_TIME_FEATURE_KEYS: readonly OneTimeFeatureKey[] = (
  Object.keys(FEATURE_PRICES) as FeatureKey[]
).filter((k): k is OneTimeFeatureKey => !isSubscriptionFeature(k))

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
