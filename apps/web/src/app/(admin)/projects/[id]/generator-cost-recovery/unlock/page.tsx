import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { Lock, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { hasFeatureSeat } from '@/lib/features'
import { FEATURE_PRICES, formatZARFromKobo } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { BuyGcrSeatButton } from './BuyGcrSeatButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Unlock Generator Cost-Recovery' }

interface Props {
  params: Promise<{ id: string }>
}

const BENEFITS = [
  'Tenant apportionment across generator zones',
  'Capital cost amortisation and per-tenant recovery calc',
  'Branded PDF cost-recovery report',
  'Configure multiple standby generators per project',
  'Per-user seat — assign to the team members who need it',
]

export default async function UnlockGcrPage({ params }: Props) {
  const { id } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Resolve project → org
  const { data: projectRow } = await (supabase as any)
    .schema('projects')
    .from('projects')
    .select('organisation_id')
    .eq('id', id)
    .maybeSingle() as { data: { organisation_id: string } | null }

  if (!projectRow) redirect(`/projects/${id}`)

  // Already has a seat → send straight to the feature
  const hasSeat = await hasFeatureSeat(
    projectRow.organisation_id,
    user.id,
    'generator_cost_recovery',
    supabase,
  )
  if (hasSeat) redirect(`/projects/${id}/generator-cost-recovery`)

  // Resolve caller's org role to decide which CTA to show
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('role')
    .eq('user_id', user.id)
    .eq('organisation_id', projectRow.organisation_id)
    .eq('is_active', true)
    .maybeSingle()
  const role = (membership as { role: string } | null)?.role ?? ''
  const isAdmin = ['owner', 'admin'].includes(role)

  const price = FEATURE_PRICES.generator_cost_recovery

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} />
            Generator Cost-Recovery
          </h1>
          <p className="page-subtitle">{price.description}</p>
        </div>
      </div>

      <Card className="animate-fadeup-1">
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--c-text)' }}>
              {formatZARFromKobo(price.amountKobo)}
            </span>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              PER SEAT
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 20 }}>
            One seat per user who needs access. Assigned to your account.
          </p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BENEFITS.map((b) => (
              <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
                <Check size={14} style={{ color: '#4ade80', marginTop: 2, flexShrink: 0 }} />
                {b}
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
              <BuyGcrSeatButton
                label={`Buy a seat — ${formatZARFromKobo(price.amountKobo)}`}
                userId={user.id}
              />
              <Link
                href="/settings/billing/seats"
                style={{
                  fontSize: 12,
                  color: 'var(--c-text-dim)',
                  fontFamily: 'var(--font-mono)',
                  letterSpacing: '0.06em',
                  textDecoration: 'none',
                }}
              >
                Manage seats →
              </Link>
            </div>
          ) : (
            <div
              style={{
                padding: '12px 14px',
                background: 'var(--c-amber-dim)',
                border: '1px solid var(--c-amber-mid)',
                borderRadius: 6,
                fontSize: 12,
                color: 'var(--c-text)',
              }}
            >
              Only an organisation <strong>owner</strong> or <strong>admin</strong> can purchase
              seats. Ask one of them to visit this page and assign you a seat.
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
            Powered by Paystack · Secure card payment in ZAR
          </p>
        </CardBody>
      </Card>

      <div style={{ marginTop: 20 }}>
        <Link
          href={`/projects/${id}/generator-cost-recovery`}
          style={{
            fontFamily: 'var(--font-mono)',
            fontSize: 11,
            color: 'var(--c-text-dim)',
            textDecoration: 'none',
            letterSpacing: '0.06em',
          }}
        >
          ← Back to project
        </Link>
      </div>
    </div>
  )
}
