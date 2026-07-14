'use client'

import Link from 'next/link'
import { usePathname } from 'next/navigation'

/**
 * Fixed tab nav for a project inside the client portal — exactly the aspects
 * chosen for client visibility (spec 2026-07-06-client-portal.md §2, plus
 * Equipment & Materials per the 2026-07-07 decision). No financial or admin
 * surfaces exist here by construction.
 */
const TABS = [
  { slug: '',                  label: 'Overview' },
  { slug: 'diary',             label: 'Site Diary' },
  { slug: 'snags',             label: 'Snags' },
  { slug: 'quality-control',   label: 'Quality Control' },
  { slug: 'inspections',       label: 'Inspections' },
  { slug: 'cables',            label: 'Cable Schedule' },
  { slug: 'equipment-materials', label: 'Equipment & Materials' },
  { slug: 'generator-recovery', label: 'Generator Recovery' },
  { slug: 'floor-plans',       label: 'Floor Plans' },
  { slug: 'handover',          label: 'Handover' },
  { slug: 'tenant-schedule',   label: 'Tenant Schedule' },
] as const

export function PortalProjectNav({ projectId }: { projectId: string }) {
  const pathname = usePathname()
  const base = `/portal/${projectId}`

  return (
    <nav
      aria-label="Project sections"
      style={{
        display: 'flex', flexWrap: 'wrap', gap: 4,
        borderBottom: '1px solid var(--c-border)',
        marginBottom: 20, paddingBottom: 8,
      }}
    >
      {TABS.map(({ slug, label }) => {
        const href = slug ? `${base}/${slug}` : base
        const active = slug ? pathname.startsWith(href) : pathname === base
        return (
          <Link
            key={slug || 'overview'}
            href={href}
            aria-current={active ? 'page' : undefined}
            style={{
              padding: '6px 12px', borderRadius: 4, fontSize: 13,
              textDecoration: 'none',
              color: active ? 'var(--c-amber)' : 'var(--c-text-mid)',
              background: active ? 'var(--c-amber-dim)' : 'transparent',
              border: `1px solid ${active ? 'var(--c-amber-mid)' : 'transparent'}`,
              fontWeight: active ? 600 : 400,
            }}
          >
            {label}
          </Link>
        )
      })}
    </nav>
  )
}
