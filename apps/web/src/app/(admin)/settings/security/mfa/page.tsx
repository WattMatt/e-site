import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { MfaEnrollClient } from './MfaEnrollClient'

export const metadata: Metadata = { title: 'Two-factor auth · Settings' }

export default async function MfaSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: factors } = await supabase.auth.mfa.listFactors()
  const verifiedFactors = (factors?.totp ?? []).filter((f) => f.status === 'verified')

  return (
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <Link
          href="/settings/security"
          style={{ fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          ← Security
        </Link>
        <h1 className="page-title">Two-factor authentication</h1>
      </div>

      <div className="data-panel">
        <div className="data-panel-header">
          <span className="data-panel-title">Authenticator app (TOTP)</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            {verifiedFactors.length > 0 ? 'enabled' : 'disabled'}
          </span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
            Use Google Authenticator, 1Password, Authy, or any RFC 6238 TOTP
            app. Once enabled, you&apos;ll be asked for a 6-digit code after
            entering your password on each new device.
          </p>
          <MfaEnrollClient
            verifiedFactors={verifiedFactors.map((f) => ({
              id: f.id,
              friendlyName: f.friendly_name ?? 'Authenticator',
              createdAt: f.created_at,
            }))}
          />
        </div>
      </div>
    </div>
  )
}
