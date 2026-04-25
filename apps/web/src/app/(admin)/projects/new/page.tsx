import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { Lock, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { checkProjectQuota } from '@/actions/project.actions'
import { PLANS, type PlanTier } from '@esite/shared'
import { NewProjectForm } from './NewProjectForm'

export const metadata: Metadata = { title: 'New Project' }

export default async function NewProjectPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) {
    // Onboarding flow handles this; safety net.
    redirect('/onboarding')
  }

  // Pre-flight tier-limit check. Same logic the server action enforces —
  // showing the paywall up front spares the user from filling out a form
  // they can't submit.
  const gate = await checkProjectQuota(membership.organisation_id)

  if (gate) return <Paywall gate={gate} />

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/projects"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Projects
        </Link>
      </div>
      <NewProjectForm />
    </div>
  )
}

function Paywall({
  gate,
}: {
  gate: { tier: PlanTier; currentCount: number; limit: number; status: string }
}) {
  const currentPlan = PLANS[gate.tier]
  const upgradeTier: PlanTier = gate.tier === 'free' ? 'starter' : 'professional'
  const upgrade = PLANS[upgradeTier]
  const monthlyZAR = (upgrade.monthlyKobo / 100).toLocaleString('en-ZA', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  })

  return (
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/projects"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Projects
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Project limit reached</h1>
          <p className="page-subtitle">
            {currentPlan.name} plan: {gate.currentCount} of {gate.limit} project{gate.limit === 1 ? '' : 's'} used
          </p>
        </div>
      </div>

      <div className="data-panel" style={{ padding: 0, overflow: 'hidden' }}>
        <div
          style={{
            padding: '20px 24px',
            borderBottom: '1px solid var(--c-border)',
            background: 'var(--c-amber-dim)',
            display: 'flex',
            alignItems: 'center',
            gap: 14,
          }}
        >
          <div
            style={{
              width: 40, height: 40, borderRadius: 10,
              background: 'var(--c-base)',
              border: '1px solid var(--c-amber-mid)',
              display: 'inline-flex',
              alignItems: 'center', justifyContent: 'center',
            }}
          >
            <Lock size={18} color="var(--c-amber)" />
          </div>
          <div>
            <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>
              Upgrade to {upgrade.name} to add another project
            </div>
            <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 2 }}>
              Your first project on E-Site is free forever — no card required. Adding more projects requires a paid plan.
            </div>
          </div>
        </div>

        <div style={{ padding: 24 }}>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 14 }}>
            <span style={{ fontSize: 28, fontWeight: 700, color: 'var(--c-text)' }}>
              R{monthlyZAR}
            </span>
            <span style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>/month</span>
            <span style={{
              marginLeft: 8,
              fontFamily: 'var(--font-mono)',
              fontSize: 10,
              color: 'var(--c-amber)',
              background: 'var(--c-amber-dim)',
              border: '1px solid var(--c-amber-mid)',
              padding: '2px 6px',
              borderRadius: 3,
              letterSpacing: '0.06em',
              textTransform: 'uppercase',
            }}>
              {upgrade.name}
            </span>
          </div>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 22px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {upgrade.features.map((f) => (
              <li key={f} style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 13, color: 'var(--c-text-mid)' }}>
                <Check size={14} color="var(--c-green)" />
                {f}
              </li>
            ))}
          </ul>

          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
            <Link href="/settings/billing" className="btn-primary-amber" style={{ textDecoration: 'none' }}>
              View plans &amp; upgrade →
            </Link>
            <Link
              href="/projects"
              style={{
                fontSize: 13,
                color: 'var(--c-text-mid)',
                textDecoration: 'none',
                padding: '9px 14px',
                border: '1px solid var(--c-border)',
                borderRadius: 6,
                background: 'var(--c-panel)',
              }}
            >
              Back to projects
            </Link>
          </div>
        </div>
      </div>

      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 14, textAlign: 'center' }}>
        Subscription status: {gate.status} · Tier: {currentPlan.name}
      </p>
    </div>
  )
}
