import { listPortalFloorPlans } from '@/lib/portal/data'
import { PortalCard, EmptyState, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Active floor plans — names/levels/scales; viewing files stays with the team for v1. */
export default async function PortalFloorPlansPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const plans = await listPortalFloorPlans(projectId)

  return (
    <PortalCard>
      {plans.length === 0 ? (
        <EmptyState label="No floor plans on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Plan</th>
                <th style={thStyle}>Level</th>
                <th style={thStyle}>Scale</th>
                <th style={thStyle}>Updated</th>
              </tr>
            </thead>
            <tbody>
              {plans.map((p) => (
                <tr key={p.id}>
                  <td style={tdStyle}>{p.name}</td>
                  <td style={tdStyle}>{p.level ?? '—'}</td>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{p.scale ?? '—'}</td>
                  <td style={tdStyle}>{fmtDate(p.updated_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
