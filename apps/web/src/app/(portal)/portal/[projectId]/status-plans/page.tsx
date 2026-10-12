import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { listPortalStatusPlans } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/**
 * Status plans — coloured drawings, read-only; each opens as a PDF computed for today.
 * The (portal) layout's requirePortalAccess gate runs before this page. The PDF opens in a new tab,
 * not an <iframe>: every same-origin response carries X-Frame-Options: DENY.
 */
export default async function PortalStatusPlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const plans = await listPortalStatusPlans(projectId)

  return (
    <PortalCard>
      {plans.length === 0 ? (
        <EmptyState label="No status plans on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Kind</th>
                <th style={thStyle}>Drawing</th>
                <th style={thStyle}>Page</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{PURPOSE_LABEL[p.purpose]}</td>
                  <td style={tdStyle}>{p.floor_plans?.name ?? '—'}</td>
                  <td style={tdStyle}>{p.page_index}</td>
                  <td style={tdStyle}>{fmtDate(p.updated_at)}</td>
                  <td style={tdStyle}>
                    <a href={`/api/portal/${projectId}/status-plans/${p.id}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${p.name}`}>
                      Open PDF
                    </a>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
