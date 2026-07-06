import { notFound } from 'next/navigation'
import { listPortalCableRevisions } from '@/lib/portal/data'
import { PortalCard, EmptyState, StatusBadge, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/**
 * Cable-schedule revisions — technical data only. Rates and costs are never
 * selected for clients (lib/portal/data.ts, mirroring export-role redaction).
 */
export default async function PortalCablesPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const revisions = await listPortalCableRevisions(projectId)
  if (revisions === null) notFound()

  return (
    <PortalCard>
      {revisions.length === 0 ? (
        <EmptyState label="No cable-schedule revisions on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Revision</th>
                <th style={thStyle}>Description</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Issued</th>
                <th style={thStyle}>Change notes</th>
              </tr>
            </thead>
            <tbody>
              {revisions.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{r.code}</td>
                  <td style={tdStyle}>{r.description ?? '—'}</td>
                  <td style={tdStyle}><StatusBadge value={r.status} /></td>
                  <td style={tdStyle}>{fmtDate(r.issued_at)}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--c-text-mid)' }}>{r.change_notes ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
