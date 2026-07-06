import { listPortalDiaryEntries } from '@/lib/portal/data'
import { PortalCard, EmptyState, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

const section = (label: string, text: string | null) =>
  text && text.trim() ? (
    <p style={{ margin: '8px 0 0', fontSize: 13, color: 'var(--c-text-mid)', whiteSpace: 'pre-wrap' }}>
      <strong style={{ color: 'var(--c-text)' }}>{label}: </strong>{text}
    </p>
  ) : null

/** Read-only site diary — progress evidence for the client. */
export default async function PortalDiaryPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const entries = await listPortalDiaryEntries(projectId)

  if (entries.length === 0) {
    return <PortalCard><EmptyState label="No site diary entries yet." /></PortalCard>
  }

  return (
    <div>
      {entries.map((e) => (
        <PortalCard key={e.id}>
          <div style={{ display: 'flex', justifyContent: 'space-between', flexWrap: 'wrap', gap: 8 }}>
            <strong style={{ fontSize: 14, color: 'var(--c-text)' }}>{fmtDate(e.entry_date)}</strong>
            <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
              {[e.entry_type, e.weather, e.workers_on_site != null ? `${e.workers_on_site} workers` : null]
                .filter(Boolean).join(' · ')}
            </span>
          </div>
          {section('Progress', e.progress_notes)}
          {section('Safety', e.safety_notes)}
          {section('Quality', e.quality_notes)}
          {section('Delays', e.delay_notes ?? e.delays)}
        </PortalCard>
      ))}
    </div>
  )
}
