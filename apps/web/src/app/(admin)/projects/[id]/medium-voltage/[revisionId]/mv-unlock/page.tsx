import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { Lock, ShieldAlert, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { hasMvAccess } from '@/lib/mv-access'
import { Card, CardBody } from '@/components/ui/Card'
import { MvSubscribeButton } from './MvSubscribeButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Unlock MV Protection' }

interface Props {
  params: Promise<{ id: string; revisionId: string }>
}

const BENEFITS = [
  'Z-bus fault study — Ik3 / Ik1 / ip / X/R for every node',
  'Protection device library + IEC/IEEE time–current curves',
  'Log-log coordination plotting',
  'Pr.Eng gated-issue sign-off workflow',
  'Per-user access on every project you work on',
]

// The per-user MV paywall (Phase 7). NOT gated by requireMvAccess — this IS the
// paywall the gated MV routes redirect to. If the user already has access we
// send them straight into the fault study.
//
// OWNER ACTION REQUIRED to make the subscribe button function: create a
// R2000/yr ZAR Plan on the Paystack dashboard and set its PLN_… code as the
// PAYSTACK_PLAN_MV_ANNUAL env var. Until then the subscribe route returns a 503
// ("MV subscription plan not configured") and this page renders but cannot
// complete a subscription.
export default async function MvUnlockPage({ params }: Props) {
  const { id: projectId, revisionId } = await params
  const supabase = await createClient()

  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  // Already subscribed (active + in-date + disclaimer accepted) → into the study.
  if (await hasMvAccess(user.id, supabase)) {
    redirect(`/projects/${projectId}/medium-voltage/${revisionId}/fault`)
  }

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div style={{ marginBottom: 16 }}>
        <Link
          href={`/projects/${projectId}/cables/${revisionId}`}
          style={{
            fontFamily: 'var(--font-mono)', fontSize: 11,
            color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em',
          }}
        >
          ← Back to schedule
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} />
            Unlock MV Protection — R2000/year
          </h1>
          <p className="page-subtitle">
            Medium-voltage fault, protection &amp; coordination study tools.
          </p>
        </div>
      </div>

      <Card className="animate-fadeup-1">
        <CardBody>
          <div style={{ display: 'flex', alignItems: 'baseline', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 36, fontWeight: 700, color: 'var(--c-text)' }}>R2000</span>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              / YEAR · PER USER · RECURRING
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 20 }}>
            Billed to you, renews annually. Cancel anytime from Paystack.
          </p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BENEFITS.map((b) => (
              <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
                <Check size={14} style={{ color: '#4ade80', marginTop: 2, flexShrink: 0 }} />
                {b}
              </li>
            ))}
          </ul>

          {/* Forced non-validation disclaimer — the engineer's professional
              responsibility is unchanged by using this tool. */}
          <div
            style={{
              padding: '14px 16px', marginBottom: 20, borderRadius: 6,
              background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
              fontSize: 13, color: 'var(--c-text)', lineHeight: 1.55,
            }}
          >
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 6, fontWeight: 600 }}>
              <ShieldAlert size={15} style={{ color: 'var(--c-amber)' }} />
              This tool is NOT a validated authority
            </div>
            The MV calculations are an engineering aid, not a validated or certified
            result. Their outputs are <strong>not independently validated</strong> and carry no
            warranty of fitness for any installation. You remain fully responsible
            for independently checking and validating <strong>every</strong> study against{' '}
            <strong>SANS 10142</strong> and your <strong>ECSA</strong> professional obligations
            before relying on or issuing it. By subscribing you accept this and confirm you will
            validate each study yourself.
          </div>

          <MvSubscribeButton label="Subscribe — R2000/year" />

          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
            Powered by Paystack · Secure recurring card payment in ZAR
          </p>
        </CardBody>
      </Card>
    </div>
  )
}
