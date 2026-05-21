import { redirect } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'

export const dynamic = 'force-dynamic'

/**
 * Owner/admin gate for the whole `/inspections/templates` subtree.
 * Non-admins (PM, field worker) are bounced to the inspection portfolio —
 * they never see the Templates tab, and the URL is closed to them too.
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
    .select('role')
    .eq('user_id', user.id)
    .eq('is_active', true)

  const isAdmin = (memberships ?? []).some(
    (m: { role: string }) => m.role === 'owner' || m.role === 'admin',
  )
  if (!isAdmin) redirect('/inspections')

  return <>{children}</>
}
