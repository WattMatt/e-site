import { listPortalTenantSchedule } from '@/lib/portal/data'
import { PortalCard, EmptyState, StatusBadge, thStyle, tdStyle } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Tenant schedule — shops/units with scope + layout status. Read-only. */
export default async function PortalTenantSchedulePage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const units = await listPortalTenantSchedule(projectId)

  return (
    <PortalCard>
      {units.length === 0 ? (
        <EmptyState label="No tenant schedule on this site yet." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Shop no.</th>
                <th style={thStyle}>Tenant</th>
                <th style={thStyle}>Section</th>
                <th style={thStyle}>Scope</th>
                <th style={thStyle}>Layout</th>
              </tr>
            </thead>
            <tbody>
              {units.map((u) => (
                <tr key={u.id}>
                  <td style={{ ...tdStyle, fontFamily: 'var(--font-mono)' }}>{u.shop_number ?? u.code}</td>
                  <td style={tdStyle}>{u.shop_name ?? '—'}</td>
                  <td style={tdStyle}>{u.section ?? '—'}</td>
                  <td style={tdStyle}><StatusBadge value={u.tenant_details?.scope_status} /></td>
                  <td style={tdStyle}><StatusBadge value={u.tenant_details?.layout_status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
