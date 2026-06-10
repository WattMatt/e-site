import { redirect } from 'next/navigation'
import type { OrgRole } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { hasFeature } from '@/lib/features'
import { hasMvAccess } from '@/lib/mv-access'
import { listMyOrganisations } from '@/actions/active-organisation.actions'
import { Sidebar } from '@/components/layout/Sidebar'
import { OrgSwitcher } from '@/components/layout/OrgSwitcher'
import { NotificationCentre } from '@/components/ui/NotificationCentre'
import { PaymentStatusBanner } from '@/components/layout/PaymentStatusBanner'
import { MinimalLegalNav } from '@/components/layout/MinimalLegalNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Resolve the user's primary org to drive the sidebar's lock indicators on
  // gated nav items (Inspection Templates, JBCC), plus role-gating of
  // admin-only footer items like /settings.
  const { data: primaryMembership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .order('created_at')
    .limit(1)
    .maybeSingle()
  const membership = primaryMembership as { organisation_id: string; role: OrgRole } | null
  const primaryOrgId = membership?.organisation_id
  const primaryRole = membership?.role ?? null
  const [inspectionsUnlocked, jbccUnlocked, mvUnlocked, orgsResult] = await Promise.all([
    primaryOrgId ? hasFeature(primaryOrgId, 'inspections', supabase) : Promise.resolve(false),
    primaryOrgId ? hasFeature(primaryOrgId, 'jbcc', supabase) : Promise.resolve(false),
    // MV is a per-USER subscription (lib/mv-access), not an org feature unlock.
    hasMvAccess(user.id, supabase),
    listMyOrganisations(),
  ])
  const orgMemberships = orgsResult.ok ? orgsResult.memberships : []

  return (
    <div className="portal-shell">
      <a href="#main-content" className="skip-link">
        Skip to main content
      </a>
      <Sidebar inspectionsUnlocked={inspectionsUnlocked} jbccUnlocked={jbccUnlocked} mvUnlocked={mvUnlocked} role={primaryRole} />
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', overflow: 'hidden', minWidth: 0 }}>
        <header className="portal-header">
          <OrgSwitcher memberships={orgMemberships} />
          <NotificationCentre />
        </header>
        <main id="main-content" className="portal-main">
          <PaymentStatusBanner />
          {children}
          <MinimalLegalNav />
        </main>
      </div>
    </div>
  )
}
