import type { Metadata } from 'next'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { OrgSettingsForm } from './OrgSettingsForm'
import { ProfileSettingsForm } from './ProfileSettingsForm'

export const metadata: Metadata = { title: 'Settings' }

export default async function SettingsPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const [profileRes, memRes] = await Promise.all([
    supabase.from('profiles').select('*').eq('id', user!.id).single(),
    supabase.from('user_organisations')
      .select('organisation_id, role, organisations(*)')
      .eq('user_id', user!.id).eq('is_active', true).limit(1).single(),
  ])

  const profile = profileRes.data
  const org = (memRes.data?.organisations as any) ?? null
  const role = memRes.data?.role ?? 'member'
  const isAdmin = ['owner', 'admin'].includes(role)

  return (
    <div className="animate-fadeup" style={{ maxWidth: 640 }}>
      <div className="page-header">
        <h1 className="page-title">Settings</h1>
      </div>

      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {/* Profile */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Your Profile</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <ProfileSettingsForm
              userId={user!.id}
              fullName={profile?.full_name ?? ''}
              phone={profile?.phone ?? ''}
              email={user!.email ?? ''}
            />
          </div>
        </div>

        {/* Organisation */}
        {isAdmin && org && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Organisation</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>Visible to all members</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <OrgSettingsForm
                orgId={org.id}
                name={org.name}
                registrationNumber={org.registration_number ?? ''}
                vatNumber={org.vat_number ?? ''}
                phone={org.phone ?? ''}
                website={org.website ?? ''}
              />
            </div>
          </div>
        )}

        {/* Users */}
        {isAdmin && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Users</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Invite teammates, assign roles, and manage who has access to your organisation.
              </p>
              <Link
                href="/settings/users"
                style={{
                  display: 'inline-block',
                  fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                  border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                  textDecoration: 'none',
                }}
              >
                Manage users →
              </Link>
            </div>
          </div>
        )}

        {/* Billing */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Billing &amp; plans</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
              View your subscription, change plan, and access invoices.
            </p>
            <Link
              href="/settings/billing"
              style={{
                display: 'inline-block',
                fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                textDecoration: 'none',
              }}
            >
              Manage billing →
            </Link>
          </div>
        </div>

        {/* Security */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Security</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
              Active sessions, sign-out-everywhere, and (soon) two-factor auth.
            </p>
            <Link
              href="/settings/security"
              style={{
                display: 'inline-block',
                fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                textDecoration: 'none',
              }}
            >
              Manage security →
            </Link>
          </div>
        </div>

        {/* Cloud-storage integrations (admin/owner/PM only — page itself
            re-checks role and bounces client_viewer to /dashboard). */}
        {isAdmin && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Cloud-storage integrations</span>
              <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>Org-level</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Connect Dropbox, Google Drive, or OneDrive — then map a folder per project to sync drawings + documents automatically.
              </p>
              <Link
                href="/settings/integrations"
                style={{
                  display: 'inline-block',
                  fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                  border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                  textDecoration: 'none',
                }}
              >
                Manage integrations →
              </Link>
            </div>
          </div>
        )}

        {/* Health */}
        {isAdmin && (
          <div className="data-panel">
            <div className="data-panel-header">
              <span className="data-panel-title">Organisation health</span>
            </div>
            <div style={{ padding: '16px 18px' }}>
              <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 12 }}>
                Track login recency and compliance activity across the organisations you administer.
              </p>
              <Link
                href="/settings/health"
                style={{
                  display: 'inline-block',
                  fontSize: 12, color: 'var(--c-amber)', background: 'transparent',
                  border: '1px solid var(--c-border)', borderRadius: 6, padding: '7px 14px',
                  textDecoration: 'none',
                }}
              >
                View health →
              </Link>
            </div>
          </div>
        )}

        {/* Danger zone */}
        <div className="data-panel" style={{ borderColor: '#6b1e1e' }}>
          <div className="data-panel-header" style={{ borderColor: '#6b1e1e' }}>
            <span className="data-panel-title" style={{ color: 'var(--c-red)' }}>Danger Zone</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
              Deleting your account is permanent and cannot be undone. All your data will be removed.
            </p>
            <Link
              href="/settings/account"
              style={{
                display: 'inline-block',
                fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)',
                border: '1px solid #6b1e1e', borderRadius: 6, padding: '7px 14px',
                textDecoration: 'none', cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              Delete Account →
            </Link>
          </div>
        </div>
      </div>
    </div>
  )
}
