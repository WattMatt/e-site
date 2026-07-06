import { listPortalHandover } from '@/lib/portal/data'
import { PortalCard, EmptyState, fmtDate } from '@/components/portal/PortalBits'

export const dynamic = 'force-dynamic'

/** Handover checklist status — read-only progress view. */
export default async function PortalHandoverPage({ params }: { params: Promise<{ projectId: string }> }) {
  const { projectId } = await params
  const items = await listPortalHandover(projectId)

  const done = items.filter((i) => i.is_complete).length

  return (
    <div>
      {items.length > 0 && (
        <p style={{ margin: '0 0 12px', fontSize: 13, color: 'var(--c-text-mid)' }}>
          {done} of {items.length} handover items complete
        </p>
      )}
      <PortalCard>
        {items.length === 0 ? (
          <EmptyState label="No handover checklist on this site yet." />
        ) : (
          <ul style={{ listStyle: 'none', margin: 0, padding: 0 }}>
            {items.map((i) => (
              <li
                key={i.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 10, padding: '9px 4px',
                  borderBottom: '1px solid var(--c-border)', fontSize: 13,
                }}
              >
                <span aria-hidden="true" style={{ color: i.is_complete ? 'var(--c-success, #22C55E)' : 'var(--c-text-dim)' }}>
                  {i.is_complete ? '✓' : '○'}
                </span>
                <span style={{ flex: 1, color: i.is_complete ? 'var(--c-text-mid)' : 'var(--c-text)' }}>{i.item}</span>
                <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>
                  {i.is_complete ? fmtDate(i.completed_at) : 'pending'}
                </span>
              </li>
            ))}
          </ul>
        )}
      </PortalCard>
    </div>
  )
}
