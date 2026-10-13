import { PURPOSE_LABEL } from '@esite/shared/status-plans'
import { listPortalTenantPlans } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/**
 * Tenant plans — the tenant floor plan and the line diagram, read-only; each opens as one PDF with
 * every sheet, coloured for today. The (portal) layout's requirePortalAccess gate runs before this
 * page. The PDF opens in a new tab, not an <iframe>: every same-origin response carries
 * X-Frame-Options: DENY.
 */
export default async function PortalTenantPlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const plans = await listPortalTenantPlans(projectId)

  return (
    <PortalCard>
      {plans.length === 0 ? (
        <EmptyState label="No tenant plans on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Sheets</th>
                <th style={thStyle}>Updated</th>
                <th style={thStyle} />
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{PURPOSE_LABEL[p.purpose]}</td>
                  <td style={tdStyle}>{p.sheets} sheet{p.sheets === 1 ? '' : 's'}</td>
                  <td style={tdStyle}>{fmtDate(p.updated_at)}</td>
                  <td style={tdStyle}>
                    <a href={`/api/portal/${projectId}/status-plans/${p.id}/pdf`} target="_blank" rel="noopener noreferrer" aria-label={`Open ${PURPOSE_LABEL[p.purpose]}`}>
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
