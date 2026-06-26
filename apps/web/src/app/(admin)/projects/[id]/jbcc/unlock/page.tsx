import { redirect } from 'next/navigation'
import Link from 'next/link'
import type { Metadata } from 'next'
import { Lock, Check } from 'lucide-react'
import { createClient } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/features'
import { FEATURE_PRICES, formatZARFromKobo } from '@esite/shared'
import { Card, CardBody } from '@/components/ui/Card'
import { UnlockJbccButton } from './UnlockJbccButton'

export const dynamic = 'force-dynamic'
export const metadata: Metadata = { title: 'Unlock JBCC Procedural Toolkit' }

const BENEFITS = [
  'Browse all 28 JBCC notice letter types with clause references',
  'Generate filled .docx notice letters per project in seconds',
  'Computed time-bar deadline tracking for every notice sent',
  'Attach proof-of-service documents to each notice record',
  'Lifetime access per organisation — pay once, no renewals',
]

export default async function UnlockJbccPage({
  params,
}: {
  params: Promise<{ id: string }>
}) {
  const { id: projectId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  const mem = membership as { organisation_id: string; role: string } | null
  if (!mem) redirect('/dashboard')

  // Already unlocked — send the user straight to the JBCC library.
  const unlocked = await hasFeature(mem.organisation_id, 'jbcc', supabase)
  if (unlocked) redirect(`/projects/${projectId}/jbcc`)

  const isAdmin = ['owner', 'admin'].includes(mem.role)
  const price = FEATURE_PRICES.jbcc

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <Lock size={18} style={{ verticalAlign: -2, marginRight: 8, opacity: 0.7 }} />
            JBCC Procedural Toolkit
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
              ONE-TIME · LIFETIME
            </span>
          </div>
          <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginBottom: 20 }}>
            Charged once per organisation. No recurring fees, no per-user pricing.
          </p>

          <ul style={{ listStyle: 'none', padding: 0, margin: '0 0 24px', display: 'flex', flexDirection: 'column', gap: 8 }}>
            {BENEFITS.map((b) => (
              <li key={b} style={{ display: 'flex', alignItems: 'flex-start', gap: 10, fontSize: 13, color: 'var(--c-text)', lineHeight: 1.5 }}>
                <Check size={14} style={{ color: 'var(--c-green)', marginTop: 2, flexShrink: 0 }} />
                {b}
              </li>
            ))}
          </ul>

          {isAdmin ? (
            <UnlockJbccButton
              label={`Unlock for ${formatZARFromKobo(price.amountKobo)}`}
              projectId={projectId}
            />
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
              Only an organisation <strong>owner</strong> or <strong>admin</strong> can unlock
              this feature. Ask one of them to visit this page.
            </div>
          )}

          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 16, fontFamily: 'var(--font-mono)' }}>
            Powered by Paystack · Secure card payment in ZAR
          </p>
        </CardBody>
      </Card>

      <div style={{ marginTop: 20 }}>
        <Link
          href={`/projects/${projectId}`}
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
