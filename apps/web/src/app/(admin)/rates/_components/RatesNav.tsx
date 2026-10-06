import Link from 'next/link'

const TABS = [
  { href: '/rates', label: 'Library' },
  { href: '/rates/review', label: 'Review queue' },
  { href: '/rates/sources', label: 'Sources' },
] as const

/** Header shared by the rate library pages. */
export function RatesNav({ active, queued }: { active: (typeof TABS)[number]['href']; queued?: number }) {
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <div>
        <h1 style={{ margin: 0 }}>Rate library</h1>
        <p style={{ color: 'var(--c-text-dim)', marginTop: 4, maxWidth: 760 }}>
          Contractor rates from priced BOQs, normalised to one catalogue. Confidential: visible to owners, admins and
          project managers of this organisation only, and every view and export is logged.
        </p>
      </div>
      <nav aria-label="Rate library" style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
        {TABS.map(t => (
          <Link key={t.href} href={t.href} aria-current={active === t.href ? 'page' : undefined}
            style={{
              padding: '6px 12px', borderRadius: 6, border: '1px solid var(--c-border)', textDecoration: 'none',
              background: active === t.href ? 'var(--c-panel)' : 'transparent', color: 'inherit', fontWeight: active === t.href ? 600 : 400,
            }}>
            {t.label}{t.href === '/rates/review' && queued ? ` (${queued})` : ''}
          </Link>
        ))}
      </nav>
    </div>
  )
}
