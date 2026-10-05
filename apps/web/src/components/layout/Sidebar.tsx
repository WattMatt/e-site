'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import { COST_VIEW_ROLES, OWNER_ADMIN, ORG_WRITE_ROLES, type OrgRole } from '@esite/shared'
import { Gavel,
  LayoutGrid, FolderOpen, AlertTriangle, BookOpen,
  MessageSquare, ShoppingBag,
  Settings, LogOut, Map, ClipboardCheck, ArrowLeft,
  Cable, BookMarked, Package, Store, Lock, ScrollText, Zap,
  ShieldCheck, FileText, BarChart3, Sun, Camera, Calculator,
  Receipt, Activity,
} from 'lucide-react'
import { SolarNavItem } from './SolarNavItem'
import { usePhoneViewport } from '@/lib/mobile/use-phone-viewport'

const IC = { className: 'sidebar-nav-icon', size: 16 } as const

// Phase 1 launch gate. When false, the Marketplace nav item still renders
// (so users see what's coming) but with an "In Development" badge — clicking
// lands on the placeholder page from the (admin)/marketplace/layout.tsx gate.
export const MARKETPLACE_ENABLED = process.env.NEXT_PUBLIC_PHASE_2_MARKETPLACE === 'true'

function InDevBadge() {
  return (
    <span
      style={{
        marginLeft: 'auto',
        fontFamily: 'var(--font-mono)',
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: '0.08em',
        textTransform: 'uppercase',
        padding: '2px 6px',
        borderRadius: 2,
        background: 'var(--c-amber-dim)',
        color: 'var(--c-amber)',
        border: '1px solid var(--c-amber-mid)',
      }}
    >
      In Dev
    </span>
  )
}

function LockedBadge({ label = 'Locked — unlock for R250' }: { label?: string }) {
  return (
    <Lock
      size={12}
      aria-label={label}
      style={{ marginLeft: 'auto', opacity: 0.7 }}
    />
  )
}

function LogoMark() {
  return (
    <div className="sidebar-logo-mark">
      <svg viewBox="0 0 20 20" fill="none" width="16" height="16" aria-hidden="true">
        <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="var(--c-base)" />
      </svg>
    </div>
  )
}

// Exported so the phone shell (MobileTabBar / MobileProjectBar) renders the
// SAME destinations as the sidebar — one list, two layouts.
export const GLOBAL_NAV = [
  { href: '/dashboard',   label: 'Dashboard',   Icon: LayoutGrid },
  { href: '/projects',    label: 'Projects',    Icon: FolderOpen },
  { href: '/solar',       label: 'Solar portfolio', Icon: Sun },
  { href: '/tariffs',     label: 'Tariffs',     Icon: Receipt },
  { href: '/inspections/templates', label: 'Inspection Templates', Icon: ClipboardCheck },
  { href: '/marketplace', label: 'Marketplace', Icon: ShoppingBag },
  // Contractor rates are commercially confidential: owner/admin/PM only (rate_* RLS + requireRolePage).
  { href: '/rates',       label: 'Rate library', Icon: Calculator },
] as const

export function projectNav(id: string) {
  return [
    { href: `/projects/${id}`,              label: 'Overview',    Icon: LayoutGrid,    exact: true },
    // Site capture is always about one project, so its single entry lives here
    // (E1, 2026-10-05) — never in the global footer.
    { href: `/projects/${id}/capture`,      label: 'Capture',     Icon: Camera,        exact: false },
    { href: `/projects/${id}/snags`,        label: 'Snags',       Icon: AlertTriangle, exact: false },
    { href: `/projects/${id}/quality-control`, label: 'Quality Control', Icon: ShieldCheck, exact: false },
    { href: `/projects/${id}/diary`,        label: 'Site Diary',  Icon: BookOpen,      exact: false },
    { href: `/rfis?projectId=${id}`,        label: 'RFIs',        Icon: MessageSquare, exact: false },
    { href: `/projects/${id}/equipment-materials`, label: 'Equipment & Materials', Icon: Package,   exact: false },
    { href: `/projects/${id}/cables`,              label: 'Cables',             Icon: Cable,         exact: false },
    { href: `/projects/${id}/medium-voltage`,      label: 'Medium Voltage',     Icon: Zap,           exact: false },
    { href: `/projects/${id}/solar`,               label: 'Solar',              Icon: Sun,           exact: false },
    { href: `/projects/${id}/load-profile`,        label: 'Load profile',       Icon: Activity,      exact: false },
    { href: `/projects/${id}/generator-cost-recovery`, label: 'Generator Cost-Recovery', Icon: Zap, exact: false },
    { href: `/projects/${id}/tenant-schedule`,    label: 'Tenant Schedule',    Icon: Store,         exact: false },
    { href: `/projects/${id}/inspections`,     label: 'Inspections',     Icon: ClipboardCheck, exact: false },
    { href: `/projects/${id}/floor-plans`,  label: 'Floor Plans', Icon: Map,           exact: false },
    { href: `/projects/${id}/handover`,     label: 'Handover',    Icon: ClipboardCheck, exact: false },
    { href: `/projects/${id}/jbcc`,         label: 'JBCC',        Icon: ScrollText,    exact: false },
    { href: `/projects/${id}/forms`,        label: 'Forms',       Icon: FileText,      exact: false },
    { href: `/projects/${id}/tenders`,      label: 'Tenders',     Icon: Gavel,         exact: false },
    { href: `/projects/${id}/settings`,     label: 'Settings',    Icon: Settings,      exact: false },
  ]
}

export const FOOTER_ITEMS = [
  { href: '/standards',           label: 'Standards',    Icon: BookMarked, adminOnly: false },
  { href: '/metrics',             label: 'Adoption',     Icon: BarChart3, adminOnly: true },
  { href: '/settings',            label: 'Settings',     Icon: Settings,  adminOnly: true },
] as const

/**
 * Hide owner/admin-only entries from non-admin roles. The pages themselves
 * enforce the gate server-side (requireRolePage / layout-level redirects) —
 * this is the discovery-surface fix so contractors/suppliers/inspectors don't
 * see links that just bounce them back to /dashboard. Shared by the sidebar and
 * the phone shell's More sheet so the two can never disagree.
 */
export function navForRole(role: OrgRole | null) {
  const isAdmin = role !== null && OWNER_ADMIN.includes(role)
  // Contractor rates are commercially confidential: owner/admin/PM only
  // (the /rates pages and the rate_* RLS enforce it; this hides the link).
  const canSeeRates = role !== null && COST_VIEW_ROLES.includes(role)
  const globalNav = GLOBAL_NAV.filter(item =>
    (item.href !== '/inspections/templates' || isAdmin) && (item.href !== '/rates' || canSeeRates))
  const footerItems = isAdmin ? FOOTER_ITEMS : FOOTER_ITEMS.filter(item => !item.adminOnly)
  return { globalNav, footerItems }
}

export function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/)
  return m ? m[1] : null
}

interface SidebarContentProps {
  inspectionsUnlocked: boolean
  jbccUnlocked: boolean
  mvUnlocked: boolean
  mvVisible: boolean
  role: OrgRole | null
  tariffAdmin: boolean
}

function SidebarContent({ inspectionsUnlocked, jbccUnlocked, mvUnlocked, mvVisible, role, tariffAdmin }: SidebarContentProps) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const projectIdFromPath = extractProjectId(pathname)
  const projectIdFromQuery = searchParams.get('projectId')
  const projectId = projectIdFromPath ?? projectIdFromQuery

  const { globalNav, footerItems } = navForRole(role)
  // On a phone the sidebar is display:none; its Solar entry would still run an
  // access check per navigation (the phone chip bar runs its own).
  const phone = usePhoneViewport()

  return (
    <>
      {/* Logo */}
      <div className="sidebar-logo">
        <LogoMark />
        <span className="sidebar-logo-text">E-Site</span>
        <span className="sidebar-version">v2</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav" aria-label="Main navigation">
        {projectId ? (
          <>
            <Link
              href="/projects"
              className="sidebar-nav-item"
              style={{ opacity: 0.6, fontSize: 12 }}
            >
              <ArrowLeft {...IC} />
              All Projects
            </Link>

            <span className="sidebar-section-label" style={{ marginTop: 12 }}>Project</span>

            {projectNav(projectId)
              .filter(({ href }) => mvVisible || !href.includes('/medium-voltage'))
              // Tenders are owner/admin/PM only (the page redirects everyone else).
              .filter(({ href }) => !href.endsWith('/tenders') || (role !== null && ORG_WRITE_ROLES.includes(role)))
              .map(({ href, label, Icon, exact }) => {
              const basePath = href.split('?')[0]
              const active = exact
                ? pathname === basePath
                : pathname === basePath || pathname.startsWith(basePath + '/')
              const isJbcc = basePath === `/projects/${projectId}/jbcc`
              const isMv = basePath === `/projects/${projectId}/medium-voltage`
              if (basePath === `/projects/${projectId}/solar`) {
                if (phone) return null
                return <SolarNavItem key={href} projectId={projectId} active={active} refreshKey={pathname} />
              }
              return (
                <Link
                  key={href}
                  href={href}
                  className={`sidebar-nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon {...IC} />
                  {label}
                  {isJbcc && !jbccUnlocked && <LockedBadge />}
                  {isMv && !mvUnlocked && <LockedBadge label="Locked — subscribe for R2000/year" />}
                </Link>
              )
            })}

            <span className="sidebar-section-label" style={{ marginTop: 12 }}>Workspace</span>
            <Link
              href="/marketplace"
              className={`sidebar-nav-item${pathname.startsWith('/marketplace') ? ' active' : ''}`}
            >
              <ShoppingBag {...IC} />
              Marketplace
              {!MARKETPLACE_ENABLED && <InDevBadge />}
            </Link>
          </>
        ) : (
          <>
            <span className="sidebar-section-label">Workspace</span>
            {globalNav.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
              const isMarketplace = href === '/marketplace'
              const isInspections = href === '/inspections/templates'
              return (
                <Link
                  key={href}
                  href={href}
                  className={`sidebar-nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon {...IC} />
                  {label}
                  {isMarketplace && !MARKETPLACE_ENABLED && <InDevBadge />}
                  {isInspections && !inspectionsUnlocked && <LockedBadge />}
                </Link>
              )
            })}
          </>
        )}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        {footerItems.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`sidebar-nav-item${pathname === href || pathname.startsWith(href + '/') ? ' active' : ''}`}
          >
            <Icon {...IC} />
            {label}
          </Link>
        ))}
        {tariffAdmin && (
          <Link
            href="/admin/tariffs"
            className={`sidebar-nav-item${pathname.startsWith('/admin/tariffs') ? ' active' : ''}`}
          >
            <BookOpen {...IC} />
            Tariff library
          </Link>
        )}
        <form action="/auth/signout" method="post">
          <button type="submit" className="sidebar-nav-item sidebar-nav-item--as-button">
            <LogOut {...IC} />
            Sign out
          </button>
        </form>
      </div>
    </>
  )
}

interface SidebarProps {
  inspectionsUnlocked?: boolean
  jbccUnlocked?: boolean
  mvUnlocked?: boolean
  /** Dark-launch: hide the Medium Voltage entry entirely (defaults hidden). */
  mvVisible?: boolean
  role?: OrgRole | null
  /** Platform tariff admins (00210 allow-list) see the Tariff library link. The pages gate themselves. */
  tariffAdmin?: boolean
}

export function Sidebar({ inspectionsUnlocked = false, jbccUnlocked = false, mvUnlocked = false, mvVisible = false, role = null, tariffAdmin = false }: SidebarProps = {}) {
  return (
    <aside className="sidebar" aria-label="Application sidebar">
      <Suspense fallback={
        <div className="sidebar-logo">
          <LogoMark />
          <span className="sidebar-logo-text">E-Site</span>
          <span className="sidebar-version">v2</span>
        </div>
      }>
        <SidebarContent inspectionsUnlocked={inspectionsUnlocked} jbccUnlocked={jbccUnlocked} mvUnlocked={mvUnlocked} mvVisible={mvVisible} role={role} tariffAdmin={tariffAdmin} />
      </Suspense>
    </aside>
  )
}
