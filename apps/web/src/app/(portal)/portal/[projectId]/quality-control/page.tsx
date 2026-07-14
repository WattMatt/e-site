import { listPortalQcReports } from '@/lib/portal/data'
import { PortalCard, EmptyState, StatusBadge, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'
import { DownloadPdfButton } from './DownloadPdfButton'

export const dynamic = 'force-dynamic'

/**
 * Read-only QC report list for the client. The 00172 SELECT policy already
 * limits a client_viewer to issued reports — this page just renders what the
 * user client returns.
 */
export default async function PortalQualityControlPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const reports = await listPortalQcReports(projectId)

  return (
    <div>
      <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--c-text-mid)' }}>
        {reports.length} issued report{reports.length === 1 ? '' : 's'}
      </p>
      <PortalCard>
        {reports.length === 0 ? (
          <EmptyState label="No quality control reports have been issued yet." />
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse' }}>
              <thead>
                <tr>
                  <th style={thStyle}>Report</th>
                  <th style={thStyle}>Location</th>
                  <th style={thStyle}>Inspected</th>
                  <th style={thStyle}>Issued</th>
                  <th style={thStyle}>Status</th>
                  <th style={thStyle}>PDF</th>
                </tr>
              </thead>
              <tbody>
                {reports.map((r) => (
                  <tr key={r.id}>
                    <td style={tdStyle}>
                      <div style={{ fontWeight: 600 }}>
                        <span style={{ fontFamily: 'var(--font-mono)', fontSize: 12, color: 'var(--c-amber)', marginRight: 8 }}>
                          QC-{r.report_no}
                        </span>
                        {r.title}
                      </div>
                      {r.description && (
                        <div style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 2 }}>{r.description}</div>
                      )}
                    </td>
                    <td style={tdStyle}>{r.location ?? '—'}</td>
                    <td style={tdStyle}>{fmtDate(r.inspection_date)}</td>
                    <td style={tdStyle}>{fmtDate(r.issued_at)}</td>
                    <td style={tdStyle}><StatusBadge value={r.status} /></td>
                    <td style={tdStyle}>
                      <DownloadPdfButton projectId={projectId} reportId={r.id} />
                    </td>
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
