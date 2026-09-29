import type { Metadata } from 'next'
import Link from 'next/link'
import { redirect } from 'next/navigation'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { DeleteAccountForm } from './DeleteAccountForm'
import { EmailChangeForm } from './EmailChangeForm'
import { WhatsAppLinkPanel, type LinkView } from './WhatsAppLinkPanel'

export const metadata: Metadata = { title: 'Account · Settings' }

export default async function AccountSettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user || !user.email) redirect('/login')

  // The caller's own link only (filtered on user.id). Read with the service
  // client because authenticated has column-limited SELECT on phone_links.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const { data: waLink } = await (createServiceClient() as any).schema('whatsapp').from('phone_links')
    .select('status, phone_e164, quiet_start, quiet_end, undeliverable_reason')
    .eq('user_id', user.id).in('status', ['active', 'undeliverable', 'pending_otp'])
    .order('created_at', { ascending: false }).limit(1).maybeSingle()

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

      <div className="data-panel" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">Email Address</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
            Change the email you use to sign in. We&apos;ll send a confirmation link
            to the new address — the change takes effect once you click it.
          </p>
          <EmailChangeForm currentEmail={user.email} />
        </div>
      </div>

      <div className="data-panel" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">WhatsApp</span>
        </div>
        <div style={{ padding: '16px 18px' }}>
          <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
            Get site items assigned to you on WhatsApp, and acknowledge, finish or add photos by replying.
          </p>
          <WhatsAppLinkPanel link={(waLink as LinkView | null) ?? null} />
        </div>
      </div>

      <div className="data-panel" style={{ borderColor: 'var(--c-red)' }}>
        <div className="data-panel-header" style={{ borderColor: 'var(--c-red)' }}>
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
