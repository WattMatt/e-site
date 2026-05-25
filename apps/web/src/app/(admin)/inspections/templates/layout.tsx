import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/features'

export const dynamic = 'force-dynamic'

/**
 * Owner/admin + inspections-feature gate for the whole `/inspections/templates`
 * subtree. Non-admins (PM, field worker) are bounced to the dashboard;
 * admins of an org that has not unlocked the inspections module are sent to
 * the paywall.
 */
export default async function InspectionTemplatesLayout({
  children,
}: {
  children: React.ReactNode
}) {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: memberships } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)

  const adminMembership = (memberships ?? []).find(
    (m: { role: string }) => m.role === 'owner' || m.role === 'admin',
  ) as { organisation_id: string } | undefined
  if (!adminMembership) redirect('/dashboard')

  const unlocked = await hasFeature(adminMembership.organisation_id, 'inspections', supabase)
  if (!unlocked) redirect('/inspections/unlock')

  return <>{children}</>
}
