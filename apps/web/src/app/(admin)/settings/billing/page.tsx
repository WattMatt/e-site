import { createClient } from '@/lib/supabase/server'
import { billingService, PLANS, formatZARFromKobo } from '@esite/shared'
import Link from 'next/link'
import { BillingCheckoutButton } from './BillingCheckoutButton'

const TIER_ORDER = ['free', 'starter', 'professional', 'enterprise'] as const

function PlanFeature({ text }: { text: string }) {
  return (
    <li style={{ display: 'flex', alignItems: 'flex-start', gap: 8, fontSize: 12, color: 'var(--c-text-mid)', lineHeight: 1.5 }}>
      <span style={{ color: '#4ade80', fontSize: 10, marginTop: 3 }}>✓</span>
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
    <div className="animate-fadeup" style={{ maxWidth: 1080 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/settings"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Settings
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Billing &amp; Plans</h1>
          <p className="page-subtitle">Manage your subscription</p>
        </div>
      </div>

      {/* Current plan banner */}
      {subscription && subscription.tier !== 'free' && (
        <div
          className="animate-fadeup animate-fadeup-1"
          style={{
            marginBottom: 20,
            padding: '16px 20px',
            background: 'var(--c-amber-dim)',
            border: '1px solid var(--c-amber-mid)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            gap: 12,
          }}
        >
          <div>
            <p style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>
              {PLANS[subscription.tier as keyof typeof PLANS]?.name ?? subscription.tier} plan
              <span style={{ marginLeft: 8, fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-amber)', fontWeight: 600, letterSpacing: '0.08em', textTransform: 'uppercase' }}>
                {subscription.billing_period}
              </span>
            </p>
            <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 2 }}>
              Status:{' '}
              <span style={{ color: subscription.status === 'active' ? '#4ade80' : 'var(--c-amber)' }}>
                {subscription.status}
              </span>
              {subscription.next_billing_date && ` · Renews ${subscription.next_billing_date}`}
            </p>
          </div>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)' }}>
            {formatZARFromKobo(subscription.amount_kobo)}
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontWeight: 400 }}>
              /{subscription.billing_period === 'annual' ? 'yr' : 'mo'}
            </span>
          </p>
        </div>
      )}

      {/* Plans grid */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(220px, 1fr))',
          gap: 12,
          marginBottom: 32,
        }}
      >
        {TIER_ORDER.map((tier) => {
          const plan = PLANS[tier]
          const isCurrent = currentTier === tier
          const isEnterprise = tier === 'enterprise'
          const monthlyZAR = plan.monthlyKobo / 100
          const annualMonthly = plan.annualKobo > 0 ? Math.round(plan.annualKobo / 12 / 100) : 0

          return (
            <div
              key={tier}
              className="data-panel"
              style={{
                display: 'flex',
                flexDirection: 'column',
                padding: 18,
                gap: 14,
                borderColor: isCurrent ? 'var(--c-amber-mid)' : 'var(--c-border)',
                boxShadow: isCurrent ? '0 0 0 1px var(--c-amber-mid)' : 'none',
              }}
            >
              <div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
                  <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--c-text)' }}>{plan.name}</h3>
                  {isCurrent && <span className="badge badge-amber">Current</span>}
                </div>
                {isEnterprise ? (
                  <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)' }}>Custom</p>
                ) : (
                  <div>
                    <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-text)' }}>
                      {monthlyZAR === 0 ? 'Free' : `R${monthlyZAR.toLocaleString()}`}
                      {monthlyZAR > 0 && (
                        <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontWeight: 400 }}>/mo</span>
                      )}
                    </p>
                    {annualMonthly > 0 && (
                      <p style={{ fontSize: 10, color: '#4ade80', fontFamily: 'var(--font-mono)', letterSpacing: '0.04em', marginTop: 2 }}>
                        or R{annualMonthly.toLocaleString()}/mo billed annually
                      </p>
                    )}
                  </div>
                )}
              </div>

              <ul style={{ display: 'flex', flexDirection: 'column', gap: 6, flex: 1, listStyle: 'none', padding: 0 }}>
                {plan.features.map((f) => <PlanFeature key={f} text={f} />)}
              </ul>

              {!isCurrent && (
                isEnterprise ? (
                  <a
                    href="mailto:sales@e-site.co.za"
                    style={{
                      display: 'block',
                      textAlign: 'center',
                      padding: '9px 12px',
                      background: 'var(--c-panel)',
                      border: '1px solid var(--c-border)',
                      borderRadius: 6,
                      color: 'var(--c-text-mid)',
                      fontSize: 12,
                      fontWeight: 600,
                      textDecoration: 'none',
                    }}
                  >
                    Contact Sales
                  </a>
                ) : tier !== 'free' ? (
                  <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                    <BillingCheckoutButton tier={tier} period="monthly" label="Monthly" />
                    {plan.annualKobo > 0 && (
                      <BillingCheckoutButton tier={tier} period="annual" label="Annual (save 17%)" variant="ghost" />
                    )}
                  </div>
                ) : null
              )}
            </div>
          )
        })}
      </div>

      {/* Invoice history */}
      {invoices.length > 0 && (
        <div>
          <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-mid)', marginBottom: 10 }}>
            Invoice History
          </h2>
          <div className="data-panel">
            {invoices.map((inv: any, idx: number) => (
              <div
                key={inv.id}
                style={{
                  padding: '12px 18px',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'space-between',
                  borderTop: idx > 0 ? '1px solid var(--c-border)' : 'none',
                }}
              >
                <div>
                  <p style={{ fontSize: 13, color: 'var(--c-text)' }}>
                    {inv.description ?? 'Subscription charge'}
                  </p>
                  <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                    {inv.paystack_reference}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
                    {formatZARFromKobo(inv.amount_kobo)}
                  </p>
                  <span
                    className={inv.status === 'paid' ? 'badge badge-green' : 'badge badge-amber'}
                  >
                    {inv.status}
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
