// The org-level inspections area is the template library; real inspections
// are tracked per-project under /projects/[id]/inspections.
import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/features'

export const dynamic = 'force-dynamic'

export default async function InspectionsIndexPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: memberships } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
  const orgId = (memberships?.[0] as { organisation_id: string } | undefined)?.organisation_id
  if (!orgId) redirect('/dashboard')

  const unlocked = await hasFeature(orgId, 'inspections', supabase)
  redirect(unlocked ? '/inspections/templates' : '/inspections/unlock')
}
