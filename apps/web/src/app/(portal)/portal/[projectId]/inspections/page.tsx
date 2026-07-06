import { notFound } from 'next/navigation'
import { listPortalInspections } from '@/lib/portal/data'
import { PortalCard, EmptyState, StatusBadge, thStyle, tdStyle, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Inspection outcomes summary — curated service read (RLS blocks client JWT). */
export default async function PortalInspectionsPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const inspections = await listPortalInspections(projectId)
  if (inspections === null) notFound()

  return (
    <PortalCard>
      {inspections.length === 0 ? (
        <EmptyState label="No inspections recorded on this site." />
      ) : (
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr>
                <th style={thStyle}>Target</th>
                <th style={thStyle}>Location</th>
                <th style={thStyle}>Status</th>
                <th style={thStyle}>Result</th>
                <th style={thStyle}>COC #</th>
                <th style={thStyle}>Certified</th>
              </tr>
            </thead>
            <tbody>
              {inspections.map((i) => (
                <tr key={i.id}>
                  <td style={tdStyle}>{i.target_label}</td>
                  <td style={tdStyle}>{i.target_location ?? '—'}</td>
                  <td style={tdStyle}><StatusBadge value={i.status} /></td>
                  <td style={tdStyle}><StatusBadge value={i.overall_result} /></td>
                  <td style={tdStyle}>{i.coc_number ?? '—'}</td>
                  <td style={tdStyle}>{fmtDate(i.certified_at)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </PortalCard>
  )
}
