import { createClient } from '@/lib/supabase/server'
import { PageHeader } from '@/components/layout/Header'
import { Card, CardBody } from '@/components/ui/Card'
import { OrgSettingsForm } from './OrgSettingsForm'
import { ProfileSettingsForm } from './ProfileSettingsForm'

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
    <div className="max-w-2xl">
      <PageHeader title="Settings" />

      <div className="space-y-6">
        {/* Profile */}
        <Card>
          <div className="px-6 py-4 border-b border-slate-700">
            <h2 className="font-semibold text-white">Your Profile</h2>
          </div>
          <CardBody>
            <ProfileSettingsForm
              userId={user!.id}
              fullName={profile?.full_name ?? ''}
              phone={profile?.phone ?? ''}
              email={user!.email ?? ''}
            />
          </CardBody>
        </Card>

        {/* Organisation */}
        {isAdmin && org && (
          <Card>
            <div className="px-6 py-4 border-b border-slate-700">
              <h2 className="font-semibold text-white">Organisation</h2>
              <p className="text-xs text-slate-400 mt-0.5">Visible to all members</p>
            </div>
            <CardBody>
              <OrgSettingsForm
                orgId={org.id}
                name={org.name}
                registrationNumber={org.registration_number ?? ''}
                vatNumber={org.vat_number ?? ''}
                phone={org.phone ?? ''}
                website={org.website ?? ''}
              />
            </CardBody>
          </Card>
        )}

        {/* Danger zone */}
        <Card className="border-red-900/40">
          <div className="px-6 py-4 border-b border-red-900/40">
            <h2 className="font-semibold text-red-400">Danger Zone</h2>
          </div>
          <CardBody>
            <p className="text-sm text-slate-400 mb-4">
              Deleting your account is permanent and cannot be undone. All your data will be removed.
            </p>
            <button className="text-sm text-red-400 hover:text-red-300 border border-red-800 hover:border-red-600 px-3 py-1.5 rounded-lg transition-colors">
              Delete Account
            </button>
          </CardBody>
        </Card>
      </div>
    </div>
  )
}
