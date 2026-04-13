'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { clsx } from 'clsx'

const NAV_ITEMS = [
  { href: '/dashboard', label: 'Dashboard', icon: '◼' },
  { href: '/projects', label: 'Projects', icon: '📁' },
  { href: '/snags', label: 'Snags', icon: '⚠' },
  { href: '/compliance', label: 'Compliance', icon: '✓' },
  { href: '/rfis', label: 'RFIs', icon: '❓' },
  { href: '/procurement', label: 'Procurement', icon: '🛒' },
  { href: '/marketplace', label: 'Marketplace', icon: '🏪' },
] as const

export function Sidebar() {
  const pathname = usePathname()

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col h-screen sticky top-0">
      {/* Logo */}
      <div className="px-6 py-5 border-b border-slate-800">
        <span className="text-xl font-bold text-white">E-Site</span>
        <span className="text-slate-500 text-xs ml-2">v2.0</span>
      </div>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-1 overflow-y-auto">
        {NAV_ITEMS.map(({ href, label, icon }) => {
          const active = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={href}
              href={href}
              className={clsx(
                'flex items-center gap-3 px-3 py-2 rounded-lg text-sm transition-colors',
                active
                  ? 'bg-blue-600/20 text-blue-400 font-medium'
                  : 'text-slate-400 hover:text-white hover:bg-slate-800'
              )}
            >
              <span className="text-base leading-none">{icon}</span>
              {label}
            </Link>
          )
        })}
      </nav>

      {/* Bottom: settings + sign out */}
      <div className="px-3 py-4 border-t border-slate-800 space-y-1">
        <Link
          href="/settings/team"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <span>👥</span> Team
        </Link>
        <Link
          href="/settings/billing"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <span>💳</span> Billing
        </Link>
        <Link
          href="/settings"
          className="flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
        >
          <span>⚙</span> Settings
        </Link>
        <form action="/auth/signout" method="post">
          <button
            type="submit"
            className="w-full flex items-center gap-3 px-3 py-2 rounded-lg text-sm text-slate-400 hover:text-white hover:bg-slate-800 transition-colors text-left"
          >
            <span>→</span> Sign out
          </button>
        </form>
      </div>
    </aside>
  )
}
