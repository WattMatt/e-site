'use client'

import Link from 'next/link'
import type { SubOrganisation } from '@esite/shared'

interface Props {
  initialSubOrgs: SubOrganisation[]
}

export function SubOrgsList({ initialSubOrgs }: Props) {
  if (initialSubOrgs.length === 0) {
    return (
      <div
        className="data-panel-empty"
        style={{ padding: '32px 24px', textAlign: 'center' }}
      >
        <p style={{ fontSize: 13, color: 'var(--c-text-mid)' }}>
          No sub-organisations yet.
        </p>
        <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6 }}>
          Create your first one above to start attaching contracting parties to projects.
        </p>
      </div>
    )
  }

  return (
    <div>
      {initialSubOrgs.map((s) => (
        <Link
          key={s.id}
          href={`/settings/sub-organizations/${s.id}`}
          className="data-panel-row"
          style={{ display: 'flex', alignItems: 'center', gap: 12, opacity: s.is_active ? 1 : 0.5 }}
        >
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
              {s.name}
            </div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
              {s.signatory_name ?? '—'}{s.phone ? ` · ${s.phone}` : ''}
            </div>
          </div>
          {!s.is_active && (
            <span className="badge badge-muted">inactive</span>
          )}
          {s.is_shadow ? (
            <span className="badge badge-amber">shadow</span>
          ) : (
            <span className="badge badge-green">claimed</span>
          )}
        </Link>
      ))}
    </div>
  )
}
