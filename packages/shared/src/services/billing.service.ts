import type { TypedSupabaseClient } from '@esite/db'

export const PLANS = {
  free: {
    tier: 'free',
    name: 'Free',
    monthlyKobo: 0,
    annualKobo: 0,
    features: ['1 project', '5 users', 'Basic snag tracking', 'RFI management'],
    limits: { projects: 1, users: 5 },
  },
  starter: {
    tier: 'starter',
    name: 'Starter',
    monthlyKobo: 49900, // R499/mo
    annualKobo: 499000, // R4,990/yr (2 months free)
    features: ['5 projects', '10 users', 'COC tracking', 'Floor plans', 'Priority email support'],
    limits: { projects: 5, users: 10 },
  },
  professional: {
    tier: 'professional',
    name: 'Professional',
    monthlyKobo: 149900, // R1,499/mo
    annualKobo: 1499000, // R14,990/yr
    features: ['Unlimited projects', '30 users', 'Marketplace access', 'API access', 'Phone support'],
    limits: { projects: -1, users: 30 },
  },
  enterprise: {
    tier: 'enterprise',
    name: 'Enterprise',
    monthlyKobo: 0, // Custom
    annualKobo: 0,
    features: ['Custom limits', 'White label', 'Dedicated CSM', 'SLA guarantee', 'Custom integrations'],
    limits: { projects: -1, users: -1 },
  },
} as const

export type PlanTier = keyof typeof PLANS

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
    const { data, error } = await client
      .schema('billing')
      .from('invoices')
      .insert({
        organisation_id: orgId,
        paystack_reference: params.paystackReference,
        amount_kobo: params.amountKobo,
        status: params.status,
        description: params.description,
        paid_at: params.paidAt,
      })
      .select()
      .single()
    if (error) throw error
    return data
  },
}
