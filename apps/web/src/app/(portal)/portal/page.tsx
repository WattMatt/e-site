import Link from 'next/link'
import { listPortalProjects } from '@/lib/portal/data'
import { PortalCard, PortalTitle, EmptyState, StatusBadge, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/**
 * Portal home — the client's sites. RLS scopes a client_viewer to exactly the
 * projects they hold a project_members row on (migration 00034), so this list
 * IS their access list.
 */
export default async function PortalHomePage() {
  const projects = await listPortalProjects()

  return (
    <div>
      <PortalTitle sub="The sites you have been given access to. Everything here is view-only.">
        Your sites
      </PortalTitle>

      {projects.length === 0 ? (
        <PortalCard>
          <EmptyState label="No sites yet — you'll see a site here as soon as your project team adds you to one." />
        </PortalCard>
      ) : (
        projects.map((p) => (
          <Link key={p.id} href={`/portal/${p.id}`} style={{ textDecoration: 'none' }}>
            <PortalCard>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 12 }}>
                <div>
                  <div style={{ fontSize: 16, fontWeight: 600, color: 'var(--c-text)' }}>{p.name}</div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 4 }}>
                    {[p.address, p.province].filter(Boolean).join(', ') || '—'}
                  </div>
                  <div style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 4 }}>
                    {fmtDate(p.start_date)} → {fmtDate(p.end_date)}
                  </div>
                </div>
                <StatusBadge value={p.status} />
              </div>
            </PortalCard>
          </Link>
        ))
      )}
    </div>
  )
}
