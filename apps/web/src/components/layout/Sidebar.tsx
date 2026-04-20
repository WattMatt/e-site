'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { usePathname, useSearchParams } from 'next/navigation'
import {
  LayoutGrid, FolderOpen, AlertTriangle, BookOpen, ShieldCheck,
  MessageSquare, ClipboardList, ShoppingBag, Users, CreditCard,
  Settings, LogOut, Activity, Map, ClipboardCheck, ArrowLeft,
} from 'lucide-react'

const IC = { className: 'sidebar-nav-icon', size: 16 } as const

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
  { href: '/compliance',  label: 'Compliance',  Icon: ShieldCheck },
  { href: '/marketplace', label: 'Marketplace', Icon: ShoppingBag },
] as const

function projectNav(id: string) {
  return [
    { href: `/projects/${id}`,              label: 'Overview',    Icon: LayoutGrid,    exact: true },
    { href: `/projects/${id}/snags`,        label: 'Snags',       Icon: AlertTriangle, exact: false },
    { href: `/projects/${id}/diary`,        label: 'Site Diary',  Icon: BookOpen,      exact: false },
    { href: `/rfis?projectId=${id}`,        label: 'RFIs',        Icon: MessageSquare, exact: false },
    { href: `/procurement?projectId=${id}`, label: 'Procurement', Icon: ClipboardList, exact: false },
    { href: `/projects/${id}/floor-plans`,  label: 'Floor Plans', Icon: Map,           exact: false },
    { href: `/projects/${id}/handover`,     label: 'Handover',    Icon: ClipboardCheck, exact: false },
  ]
}

const FOOTER_ITEMS = [
  { href: '/admin/health',     label: 'Health',   Icon: Activity },
  { href: '/settings/team',    label: 'Team',     Icon: Users },
  { href: '/settings/billing', label: 'Billing',  Icon: CreditCard },
  { href: '/settings',         label: 'Settings', Icon: Settings },
] as const

function extractProjectId(pathname: string): string | null {
  const m = pathname.match(/^\/projects\/([^/]+)/)
  return m ? m[1] : null
}

function SidebarContent() {
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
            </Link>
          </>
        ) : (
          <>
            <span className="sidebar-section-label">Workspace</span>
            {GLOBAL_NAV.map(({ href, label, Icon }) => {
              const active = pathname === href || pathname.startsWith(href + '/')
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

export function Sidebar() {
  return (
    <aside className="sidebar" aria-label="Application sidebar">
      <Suspense fallback={
        <div className="sidebar-logo">
          <LogoMark />
          <span className="sidebar-logo-text">E-Site</span>
          <span className="sidebar-version">v2</span>
        </div>
      }>
        <SidebarContent />
      </Suspense>
    </aside>
  )
}
