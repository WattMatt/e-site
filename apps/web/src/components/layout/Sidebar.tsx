'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/* ── SVG icon components ─────────────────────────────────────── */
function IconGrid() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <rect x="1.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="1.5" width="5" height="5" rx="1" />
      <rect x="1.5" y="9.5" width="5" height="5" rx="1" />
      <rect x="9.5" y="9.5" width="5" height="5" rx="1" />
    </svg>
  )
}

function IconFolder() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M1.5 4.5h4l1.5-2h7v10a1 1 0 01-1 1h-11a1 1 0 01-1-1V5.5a1 1 0 011-1z" />
    </svg>
  )
}

function IconAlert() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M8 1.5L14.5 13.5H1.5L8 1.5z" />
      <line x1="8" y1="6.5" x2="8" y2="9.5" />
      <circle cx="8" cy="11.5" r="0.5" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconBook() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M3 2.5h8a1 1 0 011 1v9a1 1 0 01-1 1H3a1 1 0 01-1-1v-9a1 1 0 011-1z" />
      <line x1="5" y1="5.5" x2="10" y2="5.5" />
      <line x1="5" y1="8" x2="10" y2="8" />
      <line x1="5" y1="10.5" x2="8" y2="10.5" />
    </svg>
  )
}

function IconShield() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M8 1.5L13.5 4v4.5C13.5 11.5 8 14.5 8 14.5S2.5 11.5 2.5 8.5V4L8 1.5z" />
      <polyline points="5.5,8 7,9.5 10.5,6" />
    </svg>
  )
}

function IconMessage() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M2 3.5h12v8H2z" rx="1" />
      <path d="M2 3.5l6 4.5 6-4.5" />
    </svg>
  )
}

function IconClipboard() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <rect x="3" y="3" width="10" height="11" rx="1" />
      <path d="M5.5 3V2.5a2.5 2.5 0 015 0V3" />
      <line x1="5.5" y1="7" x2="10.5" y2="7" />
      <line x1="5.5" y1="9.5" x2="10.5" y2="9.5" />
    </svg>
  )
}

function IconStore() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M1.5 5.5l1.5-3h10l1.5 3" />
      <path d="M1.5 5.5h13v.5a2 2 0 01-4 0 2 2 0 01-4 0 2 2 0 01-4 0v-.5" />
      <rect x="1.5" y="6.5" width="13" height="8" rx="0.5" />
      <rect x="6" y="10" width="4" height="5" />
    </svg>
  )
}

function IconUsers() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <circle cx="6" cy="5" r="2.5" />
      <path d="M1.5 13.5a4.5 4.5 0 019 0" />
      <path d="M11 7.5a2 2 0 010 4M12.5 13.5a3.5 3.5 0 00-2.5-3.3" />
    </svg>
  )
}

function IconCard() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <rect x="1.5" y="4" width="13" height="9" rx="1" />
      <line x1="1.5" y1="7" x2="14.5" y2="7" />
      <line x1="4" y1="10.5" x2="6.5" y2="10.5" />
    </svg>
  )
}

function IconGear() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <circle cx="8" cy="8" r="2.5" />
      <path d="M8 1.5v1.2M8 13.3v1.2M1.5 8h1.2M13.3 8h1.2M3.1 3.1l.85.85M12.05 12.05l.85.85M3.1 12.9l.85-.85M12.05 3.95l.85-.85" strokeLinecap="round" />
    </svg>
  )
}

function IconLogout() {
  return (
    <svg viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" className="sidebar-nav-icon">
      <path d="M6.5 3.5H3a1 1 0 00-1 1v7a1 1 0 001 1h3.5" />
      <path d="M10.5 11l3-3-3-3" />
      <line x1="13.5" y1="8" x2="6" y2="8" />
    </svg>
  )
}

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
