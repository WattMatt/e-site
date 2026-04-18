'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import {
  LayoutGrid, FolderOpen, AlertTriangle, BookOpen, ShieldCheck,
  MessageSquare, ClipboardList, ShoppingBag, Users, CreditCard,
  Settings, LogOut,
} from 'lucide-react'

const IC = { className: 'sidebar-nav-icon', size: 16 } as const

const IconGrid      = () => <LayoutGrid    {...IC} />
const IconFolder    = () => <FolderOpen    {...IC} />
const IconAlert     = () => <AlertTriangle {...IC} />
const IconBook      = () => <BookOpen      {...IC} />
const IconShield    = () => <ShieldCheck   {...IC} />
const IconMessage   = () => <MessageSquare {...IC} />
const IconClipboard = () => <ClipboardList {...IC} />
const IconStore     = () => <ShoppingBag   {...IC} />
const IconUsers     = () => <Users         {...IC} />
const IconCard      = () => <CreditCard    {...IC} />
const IconGear      = () => <Settings      {...IC} />
const IconLogout    = () => <LogOut        {...IC} />

/* ── Logo mark ───────────────────────────────────────────────── */
function LogoMark() {
  return (
    <div className="sidebar-logo-mark">
      <svg viewBox="0 0 20 20" fill="none" width="16" height="16">
        <path d="M10 2L17 7V18H13V12H7V18H3V7L10 2Z" fill="#0D0B09" />
      </svg>
    </div>
  )
}

/* ── Nav definition ──────────────────────────────────────────── */
const NAV_ITEMS = [
  { href: '/dashboard',   label: 'Dashboard',   Icon: IconGrid },
  { href: '/projects',    label: 'Projects',    Icon: IconFolder },
  { href: '/snags',       label: 'Snags',       Icon: IconAlert },
  { href: '/diary',       label: 'Site Diary',  Icon: IconBook },
  { href: '/compliance',  label: 'Compliance',  Icon: IconShield },
  { href: '/rfis',        label: 'RFIs',        Icon: IconMessage },
  { href: '/procurement', label: 'Procurement', Icon: IconClipboard },
  { href: '/marketplace', label: 'Marketplace', Icon: IconStore },
] as const

const FOOTER_ITEMS = [
  { href: '/settings/team',    label: 'Team',     Icon: IconUsers },
  { href: '/settings/billing', label: 'Billing',  Icon: IconCard },
  { href: '/settings',         label: 'Settings', Icon: IconGear },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="sidebar">
      {/* Logo */}
      <div className="sidebar-logo">
        <LogoMark />
        <span className="sidebar-logo-text">E-Site</span>
        <span className="sidebar-version">v2</span>
      </div>

      {/* Nav */}
      <nav className="sidebar-nav">
        <span className="sidebar-section-label">Workspace</span>
        {NAV_ITEMS.map(({ href, label, Icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={`sidebar-nav-item${active ? ' active' : ''}`}
            >
              <Icon />
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Footer */}
      <div className="sidebar-footer">
        {FOOTER_ITEMS.map(({ href, label, Icon }) => (
          <Link
            key={href}
            href={href}
            className="sidebar-nav-item"
          >
            <Icon />
            {label}
          </Link>
        ))}
        <form action="/auth/signout" method="post">
          <button type="submit" className="sidebar-nav-item" style={{ width: '100%', background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
            <IconLogout />
            Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
