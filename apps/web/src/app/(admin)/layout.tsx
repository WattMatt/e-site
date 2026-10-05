import Link from 'next/link'
import { redirect } from 'next/navigation'
import type { OrgRole } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { getOrgContext } from '@/lib/auth-org'
import { hasFeature } from '@/lib/features'
import { hasMvAccess } from '@/lib/mv-access'
import { listMyOrganisations } from '@/actions/active-organisation.actions'
import { touchPresence } from '@/lib/presence'
import { Sidebar } from '@/components/layout/Sidebar'
import { OrgSwitcher } from '@/components/layout/OrgSwitcher'
import { NotificationCentre, NotificationsProvider } from '@/components/ui/NotificationCentre'
import { MobileTabBar } from '@/components/layout/MobileTabBar'
import { MobileProjectBar } from '@/components/layout/MobileProjectBar'
import { ThemeToggle } from '@/components/theme/ThemeToggle'
import { PaymentStatusBanner } from '@/components/layout/PaymentStatusBanner'
import { MinimalLegalNav } from '@/components/layout/MinimalLegalNav'

export default async function AdminLayout({ children }: { children: React.ReactNode }) {
  const supabase = await createClient()
  const {
    data: { user },
  } = await supabase.auth.getUser()

  if (!user) redirect('/login')

  // Clients never see the admin shell. The gate lives HERE (not per-page) so
  // every current and future (admin) route is fail-closed for client_viewer —
  // they are bounced to the dedicated viewing-only portal. Uses getOrgContext
  // (active-org role), so a user who is client_viewer in one org but staff in
  // another is routed per their currently-active org.
  const ctx = await getOrgContext()
  if (ctx?.role === 'client_viewer') redirect('/portal')

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
  const [inspectionsUnlocked, jbccUnlocked, mvUnlocked, orgsResult, , tariffAdminRes] = await Promise.all([
    primaryOrgId ? hasFeature(primaryOrgId, 'inspections', supabase) : Promise.resolve(false),
    primaryOrgId ? hasFeature(primaryOrgId, 'jbcc', supabase) : Promise.resolve(false),
    // MV is a per-USER subscription (lib/mv-access), not an org feature unlock.
    hasMvAccess(user.id, supabase),
    listMyOrganisations(),
    // Presence: one upsert + one indexed lookup, run alongside the four reads
    // this layout already awaits, so it adds no wall-clock time. Never throws.
    touchPresence('web'),
    // Platform tariff admins (00210 allow-list) see the Tariff library link. The pages gate themselves.
    // Cast: the generated Database types predate 00210 (same as the Solar pages' AnyClient casts).
    (supabase as unknown as { rpc: (fn: string) => PromiseLike<{ data: unknown; error: unknown }> }).rpc('is_platform_tariff_admin'),
  ])
  const tariffAdmin = !tariffAdminRes.error && tariffAdminRes.data === true
  const orgMemberships = orgsResult.ok ? orgsResult.memberships : []
  // Dark-launch switch: surface the Medium Voltage tab only for entitled users,
  // or for everyone once the Paystack annual plan is configured (so strangers
  // never see a locked tab whose subscribe flow would 503).
  const mvVisible = mvUnlocked || Boolean(process.env.PAYSTACK_PLAN_MV_ANNUAL)

  return (
    <NotificationsProvider>
      <div className="portal-shell">
        <a href="#main-content" className="skip-link">
          Skip to main content
        </a>
        <Sidebar inspectionsUnlocked={inspectionsUnlocked} jbccUnlocked={jbccUnlocked} mvUnlocked={mvUnlocked} mvVisible={mvVisible} role={primaryRole} tariffAdmin={tariffAdmin} />
        {/* Below 768 px the sidebar is hidden and the page scrolls as a document
            (so phone browser toolbars can collapse); .portal-top sticks instead. */}
        <div className="portal-column">
          <div className="portal-top">
            <header className="portal-header">
              <Link href="/dashboard" className="portal-header-brand" aria-label="E-Site home">
                <span className="sidebar-logo-mark" aria-hidden="true">
                  <svg viewBox="0 0 20 20" fill="none" width="16" height="16"><path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="var(--c-base)" /></svg>
                </span>
              </Link>
              <div className="portal-header-org">
                <OrgSwitcher memberships={orgMemberships} />
              </div>
              <div className="portal-header-desktop-only">
                <ThemeToggle />
              </div>
              <NotificationCentre />
            </header>
            <MobileProjectBar mvVisible={mvVisible} />
          </div>
          <main id="main-content" className="portal-main">
            <PaymentStatusBanner />
            {children}
            <MinimalLegalNav />
          </main>
        </div>
        <MobileTabBar role={primaryRole} tariffAdmin={tariffAdmin} />
      </div>
    </NotificationsProvider>
  )
}
