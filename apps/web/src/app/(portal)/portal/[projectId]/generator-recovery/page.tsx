import { notFound } from 'next/navigation'
import { listPortalGcrReports } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Issued generator cost-recovery reports — the client is the recovery beneficiary. */
export default async function PortalGeneratorRecoveryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const reports = await listPortalGcrReports(projectId)
  if (reports === null) notFound()

  return (
    <PortalCard>
      {reports.length === 0 ? (
        <EmptyState label="No generator cost-recovery reports issued for this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Revision</th>
                <th style={thStyle}>Report</th>
                <th style={thStyle}>Note</th>
                <th style={thStyle}>Created</th>
              </tr>
            </thead>
            <tbody>
              {reports.map((r) => (
                <tr key={r.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>Rev {r.revision_number}</td>
                  <td style={tdStyle}>{r.file_name}</td>
                  <td style={{ ...tdStyle, fontSize: 12, color: 'var(--c-text-mid)' }}>{r.note ?? '—'}</td>
                  <td style={tdStyle}>{fmtDate(r.created_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <p style={{ margin: '12px 0 0', fontSize: 12, color: 'var(--c-text-dim)' }}>
        Ask your project team for the full report document of any revision.
      </p>
    </PortalCard>
  )
}
