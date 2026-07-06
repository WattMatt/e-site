import { notFound } from 'next/navigation'
import { getPortalProject } from '@/lib/portal/data'
import { PortalCard, StatusBadge, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Project overview — key facts only; financials are never selected (data.ts). */
export default async function PortalOverviewPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const project = await getPortalProject(projectId)
  if (!project) notFound()

  const rows: Array<[string, React.ReactNode]> = [
    ['Status', <StatusBadge key="s" value={project.status} />],
    ['Client', project.client_name ?? '—'],
    ['Address', [project.address, project.province].filter(Boolean).join(', ') || '—'],
    ['Start date', fmtDate(project.start_date)],
    ['Planned completion', fmtDate(project.end_date)],
  ]

  return (
    <div>
      <PortalCard>
        <dl style={{ margin: 0, display: 'grid', gridTemplateColumns: 'max-content 1fr', gap: '10px 24px' }}>
          {rows.map(([label, value]) => (
            <div key={label} style={{ display: 'contents' }}>
              <dt style={{ fontSize: 12, color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{label}</dt>
              <dd style={{ margin: 0, fontSize: 13, color: 'var(--c-text)' }}>{value}</dd>
            </div>
          ))}
        </dl>
      </PortalCard>
      {project.description && (
        <PortalCard>
          <p style={{ margin: 0, fontSize: 13, lineHeight: 1.65, color: 'var(--c-text-mid)', whiteSpace: 'pre-wrap' }}>
            {project.description}
          </p>
        </PortalCard>
      )}
    </div>
  )
}
