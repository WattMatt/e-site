'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

const ITEMS = [
  { href: '/admin/tariffs', label: 'Overview', exact: true },
  { href: '/admin/tariffs/licensees', label: 'Licensees', exact: false },
  { href: '/admin/tariffs/sources', label: 'Source documents', exact: false },
  { href: '/admin/tariffs/cycle', label: 'Update cycle', exact: false },
  { href: '/admin/tariffs/years', label: 'Tariff years', exact: false },
  { href: '/admin/tariffs/calendars', label: 'TOU calendars', exact: false },
  { href: '/admin/tariffs/reports', label: 'Error reports', exact: false },
]

export function AdminTariffNav() {
  const pathname = usePathname()
  return (
    <nav aria-label="Tariff library" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
      {ITEMS.map((i) => {
        const active = i.exact ? pathname === i.href : pathname.startsWith(i.href)
        return (
          <Link key={i.href} href={i.href} aria-current={active ? 'page' : undefined}
            style={{ padding: '8px 12px', fontSize: 13, textDecoration: 'none', color: active ? 'var(--c-text)' : 'var(--c-text-mid)',
              borderBottom: `2px solid ${active ? 'var(--c-amber)' : 'transparent'}` }}>
            {i.label}
          </Link>
        )
      })}
    </nav>
  )
}
