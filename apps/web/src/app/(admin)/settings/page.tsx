import type { Metadata } from 'next'
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

        {/* Danger zone */}
        <div className="data-panel" style={{ borderColor: '#6b1e1e' }}>
          <div className="data-panel-header" style={{ borderColor: '#6b1e1e' }}>
            <span className="data-panel-title" style={{ color: 'var(--c-red)' }}>Danger Zone</span>
          </div>
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginBottom: 14 }}>
              Deleting your account is permanent and cannot be undone. All your data will be removed.
            </p>
            <button
              style={{
                fontSize: 12, color: 'var(--c-red)', background: 'var(--c-red-dim)',
                border: '1px solid #6b1e1e', borderRadius: 6, padding: '7px 14px',
                cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              Delete Account
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
