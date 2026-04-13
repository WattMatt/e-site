import { createClient } from '@/lib/supabase/server'
import { billingService, PLANS, formatZARFromKobo } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { BillingCheckoutButton } from './BillingCheckoutButton'

const TIER_ORDER = ['free', 'starter', 'professional', 'enterprise'] as const

function PlanFeature({ text }: { text: string }) {
  return (
    <li className="flex items-center gap-2 text-sm text-slate-300">
      <span className="text-emerald-400 text-xs">✓</span>
      {text}
    </li>
  )
}

export default async function BillingPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = mem?.organisation_id ?? ''
  const [subscription, invoices] = await Promise.all([
    billingService.getSubscription(supabase as any, orgId).catch(() => null),
    billingService.getInvoices(supabase as any, orgId).catch(() => []),
  ])

  const currentTier = subscription?.tier ?? 'free'

  return (
    <div className="max-w-5xl">
      <PageHeader
        title="Billing & Plans"
        subtitle="Manage your subscription"
      />

      {/* Current plan banner */}
      {subscription && subscription.tier !== 'free' && (
        <div className="mb-6 bg-blue-900/30 border border-blue-700 rounded-xl px-5 py-4 flex items-center justify-between">
          <div>
            <p className="text-white font-semibold">
              {PLANS[subscription.tier as keyof typeof PLANS]?.name ?? subscription.tier} plan
              <span className="ml-2 text-xs text-blue-300 font-normal">{subscription.billing_period}</span>
            </p>
            <p className="text-sm text-slate-400">
              Status: <span className={subscription.status === 'active' ? 'text-emerald-400' : 'text-amber-400'}>{subscription.status}</span>
              {subscription.next_billing_date && ` · Renews ${subscription.next_billing_date}`}
            </p>
          </div>
          <p className="text-2xl font-bold text-white">
            {formatZARFromKobo(subscription.amount_kobo)}
            <span className="text-sm text-slate-400 font-normal">/{subscription.billing_period === 'annual' ? 'yr' : 'mo'}</span>
          </p>
        </div>
      )}

      {/* Plans grid */}
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-4 mb-10">
        {TIER_ORDER.map((tier) => {
          const plan = PLANS[tier]
          const isCurrent = currentTier === tier
          const isEnterprise = tier === 'enterprise'
          const monthlyZAR = plan.monthlyKobo / 100
          const annualMonthly = plan.annualKobo > 0 ? Math.round(plan.annualKobo / 12 / 100) : 0

          return (
            <Card
              key={tier}
              className={isCurrent ? 'border-blue-500 ring-1 ring-blue-500' : ''}
            >
              <CardBody className="flex flex-col h-full">
                <div className="mb-4">
                  <div className="flex items-center justify-between mb-1">
                    <h3 className="font-bold text-white">{plan.name}</h3>
                    {isCurrent && (
                      <span className="text-xs bg-blue-600 text-white px-2 py-0.5 rounded-full">Current</span>
                    )}
                  </div>
                  {isEnterprise ? (
                    <p className="text-2xl font-bold text-white">Custom</p>
                  ) : (
                    <div>
                      <p className="text-2xl font-bold text-white">
                        {monthlyZAR === 0 ? 'Free' : `R${monthlyZAR.toLocaleString()}`}
                        {monthlyZAR > 0 && <span className="text-sm text-slate-400 font-normal">/mo</span>}
                      </p>
                      {annualMonthly > 0 && (
                        <p className="text-xs text-emerald-400">or R{annualMonthly.toLocaleString()}/mo billed annually</p>
                      )}
                    </div>
                  )}
                </div>

                <ul className="space-y-2 mb-6 flex-1">
                  {plan.features.map((f) => <PlanFeature key={f} text={f} />)}
                </ul>

                {!isCurrent && (
                  isEnterprise ? (
                    <a
                      href="mailto:sales@e-site.co.za"
                      className="block text-center py-2.5 rounded-lg bg-slate-700 hover:bg-slate-600 text-white text-sm font-medium transition-colors"
                    >
                      Contact Sales
                    </a>
                  ) : tier !== 'free' ? (
                    <div className="space-y-2">
                      <BillingCheckoutButton tier={tier} period="monthly" label="Monthly" />
                      {plan.annualKobo > 0 && (
                        <BillingCheckoutButton tier={tier} period="annual" label="Annual (save 17%)" variant="ghost" />
                      )}
                    </div>
                  ) : null
                )}
              </CardBody>
            </Card>
          )
        })}
      </div>

      {/* Invoice history */}
      {invoices.length > 0 && (
        <div>
          <h2 className="text-lg font-semibold text-white mb-4">Invoice History</h2>
          <Card>
            <div className="divide-y divide-slate-700/50">
              {invoices.map((inv: any) => (
                <div key={inv.id} className="px-6 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{inv.description ?? 'Subscription charge'}</p>
                    <p className="text-xs text-slate-400">{inv.paystack_reference}</p>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-semibold text-white">{formatZARFromKobo(inv.amount_kobo)}</p>
                    <span className={`text-xs ${inv.status === 'paid' ? 'text-emerald-400' : 'text-amber-400'}`}>{inv.status}</span>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}
    </div>
  )
}
