'use client'
import Link from 'next/link'
import { usePathname } from 'next/navigation'

export function TariffsNav({ mapEnabled, tariffAdmin }: { mapEnabled: boolean; tariffAdmin: boolean }) {
  const pathname = usePathname()
  const items = [
    { href: '/tariffs', label: 'Explorer', active: pathname === '/tariffs' || /^\/tariffs\/[0-9a-f-]{36}/.test(pathname) },
    ...(mapEnabled ? [{ href: '/tariffs/map', label: 'Area of supply', active: pathname.startsWith('/tariffs/map') }] : []),
    { href: '/tariffs/compare', label: 'Compare', active: pathname.startsWith('/tariffs/compare') },
    ...(tariffAdmin ? [{ href: '/admin/tariffs/cycle', label: 'Update cycle (admin)', active: false }] : []),
  ]
  return (
    <nav aria-label="Tariffs" style={{ display: 'flex', flexWrap: 'wrap', gap: 2, borderBottom: '1px solid var(--c-border)' }}>
      {items.map((i) => (
        <Link key={i.href} href={i.href} aria-current={i.active ? 'page' : undefined}
          style={{ padding: '8px 12px', fontSize: 13, textDecoration: 'none', color: i.active ? 'var(--c-text)' : 'var(--c-text-mid)',
            borderBottom: `2px solid ${i.active ? 'var(--c-amber)' : 'transparent'}` }}>
          {i.label}
        </Link>
      ))}
    </nav>
  )
}
