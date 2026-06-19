import Link from 'next/link'
import { Building2 } from 'lucide-react'
import { EmptyState } from '@/components/ui/EmptyState'
import { getClientSitesAction } from '../../portal-gcr.actions'

export default async function PortalSitesPage() {
  const result = await getClientSitesAction()
  const sites = Array.isArray(result) ? result : []
  const error = Array.isArray(result) ? null : result.error

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
      <div>
        <h1 style={{ fontSize: 18, fontWeight: 700, color: 'var(--c-text)' }}>My sites</h1>
        <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 4 }}>
          Sites your project team has shared with you for review.
        </p>
      </div>

      {error && (
        <p style={{ color: 'var(--c-red)', fontSize: 13 }}>{error}</p>
      )}

      {!error && sites.length === 0 && (
        <EmptyState
          icon={Building2}
          title="No sites yet"
          description="No sites have been shared with you yet. Your project team will grant access when a review is ready."
        />
      )}

      {sites.length > 0 && (
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(260px, 1fr))',
            gap: 12,
          }}
        >
          {sites.map((s) => (
            <Link
              key={s.project_id}
              href={`/portal/sites/${s.project_id}/gcr`}
              style={{
                border: '1px solid var(--c-border)',
                background: 'var(--c-panel)',
                borderRadius: 8,
                padding: 16,
                textDecoration: 'none',
                color: 'var(--c-text)',
                display: 'block',
              }}
            >
              <div style={{ fontSize: 14, fontWeight: 600 }}>{s.project_name}</div>
              {s.organisation_name && (
                <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginTop: 4 }}>
                  {s.organisation_name}
                </div>
              )}
              <div style={{ fontSize: 11, color: 'var(--c-amber)', marginTop: 12 }}>
                Review cost recovery →
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
