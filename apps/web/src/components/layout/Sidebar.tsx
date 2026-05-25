'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutGrid, FolderOpen, AlertTriangle, BookOpen,
  MessageSquare, ShoppingBag,
  Settings, LogOut, Map, ClipboardCheck, ArrowLeft,
  Cable, BookMarked, HardHat, Package, Store, Zap, Lock,
} from 'lucide-react'

const IC = { className: 'sidebar-nav-icon', size: 16 } as const

// Phase 1 launch gate. When false, the Marketplace nav item still renders
// (so users see what's coming) but with an "In Development" badge — clicking
// lands on the placeholder page from the (admin)/marketplace/layout.tsx gate.
const MARKETPLACE_ENABLED = process.env.NEXT_PUBLIC_PHASE_2_MARKETPLACE === 'true'

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

function LockedBadge() {
  return (
    <Lock
      size={12}
      aria-label="Locked — unlock for R250"
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

const GLOBAL_NAV = [
  { href: '/dashboard',   label: 'Dashboard',   Icon: LayoutGrid },
  { href: '/projects',    label: 'Projects',    Icon: FolderOpen },
  { href: '/inspections/templates', label: 'Inspection Templates', Icon: ClipboardCheck },
  { href: '/marketplace', label: 'Marketplace', Icon: ShoppingBag },
] as const

function projectNav(id: string) {
  return [
    { href: `/projects/${id}`,              label: 'Overview',    Icon: LayoutGrid,    exact: true },
    { href: `/projects/${id}/snags`,        label: 'Snags',       Icon: AlertTriangle, exact: false },
    { href: `/projects/${id}/diary`,        label: 'Site Diary',  Icon: BookOpen,      exact: false },
    { href: `/rfis?projectId=${id}`,        label: 'RFIs',        Icon: MessageSquare, exact: false },
    { href: `/projects/${id}/materials`,    label: 'Materials',   Icon: Package,       exact: false },
    { href: `/projects/${id}/cables`,              label: 'Cables',             Icon: Cable,         exact: false },
    { href: `/projects/${id}/equipment-schedule`, label: 'Equipment',          Icon: Zap,           exact: false },
    { href: `/projects/${id}/tenant-schedule`,    label: 'Tenant Schedule',    Icon: Store,         exact: false },
    { href: `/projects/${id}/inspections`,     label: 'Inspections',     Icon: ClipboardCheck, exact: false },
    { href: `/projects/${id}/floor-plans`,  label: 'Floor Plans', Icon: Map,           exact: false },
    { href: `/projects/${id}/handover`,     label: 'Handover',    Icon: ClipboardCheck, exact: false },
  ]
}

const FOOTER_ITEMS = [
  { href: '/site',                   label: 'Site capture', Icon: HardHat },
  { href: '/cable-schedule/sans',    label: 'SANS ref',     Icon: BookMarked },
  { href: '/settings',               label: 'Settings',     Icon: Settings },
] as const

function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/)
  return m ? m[1] : null
}

function SidebarContent({ inspectionsUnlocked }: { inspectionsUnlocked: boolean }) {
  const pathname = usePathname()
  const searchParams = useSearchParams()

  const projectIdFromPath = extractProjectId(pathname)
  const projectIdFromQuery = searchParams.get('projectId')
  const projectId = projectIdFromPath ?? projectIdFromQuery

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

            {projectNav(projectId).map(({ href, label, Icon, exact }) => {
              const basePath = href.split('?')[0]
              const active = exact
                ? pathname === basePath
                : pathname === basePath || pathname.startsWith(basePath + '/')
              return (
                <Link
                  key={href}
                  href={href}
                  className={`sidebar-nav-item${active ? ' active' : ''}`}
                  aria-current={active ? 'page' : undefined}
                >
                  <Icon {...IC} />
                  {label}
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
            {GLOBAL_NAV.map(({ href, label, Icon }) => {
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
        {FOOTER_ITEMS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className={`sidebar-nav-item${pathname === href || pathname.startsWith(href + '/') ? ' active' : ''}`}
          >
            <Icon {...IC} />
            {label}
          </Link>
        ))}
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

export function Sidebar({ inspectionsUnlocked = false }: { inspectionsUnlocked?: boolean } = {}) {
  return (
    <aside className="sidebar" aria-label="Application sidebar">
      <Suspense fallback={
        <div className="sidebar-logo">
          <LogoMark />
          <span className="sidebar-logo-text">E-Site</span>
          <span className="sidebar-version">v2</span>
        </div>
      }>
        <SidebarContent inspectionsUnlocked={inspectionsUnlocked} />
      </Suspense>
    </aside>
  )
}
