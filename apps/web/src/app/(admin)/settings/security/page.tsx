import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { getActiveSessionsAction } from '@/actions/security.actions'
import { SessionList } from './SessionList'

export const metadata: Metadata = { title: 'Security · Settings' }

export default async function SecuritySettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { sessions, error } = await getActiveSessionsAction()

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      <div className="page-header">
        <Link
          href="/settings"
          style={{ fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          ← Settings
        </Link>
        <h1 className="page-title">Security</h1>
      </div>

      <div className="data-panel" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">Active Sessions</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
            {sessions ? `${sessions.length} active` : 'unavailable'}
          </span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
            Each active sign-in shows up here. If you spot one you don&apos;t recognise,
            sign out everywhere and change your password.
          </p>
          {error
            ? <p style={{ fontSize: 12, color: 'var(--c-red)' }}>{error}</p>
            : <SessionList sessions={sessions ?? []} />}
        </div>
      </div>

      <div className="data-panel">
        <div className="data-panel-header">
          <span className="data-panel-title">Two-Factor Authentication</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
            Add a TOTP authenticator (Google Authenticator, 1Password, Authy, etc.)
            so a stolen password alone can&apos;t access your account.
          </p>
          <Link
            href="/settings/security/mfa"
            style={{
              display: 'inline-block',
              fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
              border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
              textDecoration: 'none',
            }}
          >
            Manage two-factor authentication →
          </Link>
        </div>
      </div>
    </div>
  )
}
