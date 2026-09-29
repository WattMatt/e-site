import Link from 'next/link'
import { LOAD_SUBTABS, loadHref, type LoadSubTab } from '@/lib/solar/load/subtabs'

export function LoadSubTabs({ projectId, active }: { projectId: string; active: LoadSubTab }) {
  return (
    <nav aria-label="Load sections" style={{ display: 'flex', gap: 4, margin: '12px 0' }}>
      {LOAD_SUBTABS.map((t) => (
        <Link key={t.key} href={loadHref(projectId, t.key)} aria-current={t.key === active ? 'page' : undefined}
          style={{ padding: '6px 10px', fontSize: 13, borderRadius: 6, textDecoration: 'none',
            background: t.key === active ? 'var(--c-amber-dim)' : 'transparent', color: t.key === active ? 'var(--c-text)' : 'var(--c-text-mid)' }}>
          {t.label}
        </Link>
      ))}
    </nav>
  )
}
