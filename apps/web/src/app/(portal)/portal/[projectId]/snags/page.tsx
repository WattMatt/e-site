import { listPortalSnags } from '@/lib/portal/data'
import { PortalCard, EmptyState, StatusBadge, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Read-only snag list — quality visibility for the client. */
export default async function PortalSnagsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const snags = await listPortalSnags(projectId)

  const open = snags.filter((s) => s.status !== 'resolved' && s.status !== 'signed_off' && s.status !== 'closed').length

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--c-text-mid)' }}>
        {snags.length} snag{snags.length === 1 ? '' : 's'} · {open} open
      </p>
      <PortalCard>
        {snags.length === 0 ? (
          <EmptyState label="No snags recorded on this site." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Snag</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Priority</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>Raised</th>
                </tr>
              </thead>
              <tbody>
                {snags.map((s) => (
                  <tr key={s.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>{s.title}</div>
                      {s.description && (
                        <div style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 2 }}>{s.description}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{s.location ?? '—'}</td>
                    <td style={tdStyle}><StatusBadge value={s.priority} /></td>
                    <td style={tdStyle}><StatusBadge value={s.status} /></td>
                    <td style={tdStyle}>{fmtDate(s.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </PortalCard>
    </div>
  )
}
