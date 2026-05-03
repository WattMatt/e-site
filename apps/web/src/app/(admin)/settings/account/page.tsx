import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { DeleteAccountForm } from './DeleteAccountForm'

export const metadata: Metadata = { title: 'Account · Settings' }

export default async function AccountSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) redirect('/login')

  return (
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <Link
          href="/settings"
          style={{ fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: 0.4 }}
        >
          ← Settings
        </Link>
        <h1 className="page-title">Account</h1>
      </div>

      <div className="data-panel" style={{ borderColor: '#6b1e1e' }}>
        <div className="data-panel-header" style={{ borderColor: '#6b1e1e' }}>
          <span className="data-panel-title" style={{ color: 'var(--c-red)' }}>Delete Account</span>
          <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>POPIA §24</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 10 }}>
            Permanently delete your account and personal data. This action cannot be undone.
          </p>
          <ul style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: '0 0 14px 0', paddingLeft: 18, lineHeight: 1.7 }}>
            <li>Your profile, organisation memberships, and notifications will be removed.</li>
            <li>Project records you created (snags, RFIs, attachments) remain with the organisation; your name is removed where the schema allows.</li>
            <li>An audit row is kept under POPIA §16 (accountability) — it does not contain personal data after deletion.</li>
            <li>If you are the sole owner of an organisation or have an active paid subscription, transfer ownership and cancel billing first.</li>
          </ul>
          <DeleteAccountForm email={user.email} />
        </div>
      </div>
    </div>
  )
}
