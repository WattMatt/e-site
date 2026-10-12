import Link from 'next/link'
import { ClipboardCheck } from 'lucide-react'
import type { InspectionOverview, InspectionOverviewItem } from '@esite/shared'

const STATUS_LABEL: Record<string, string> = {
  assigned: 'assigned',
  in_progress: 'in progress',
  awaiting_verification: 'awaiting verification',
  're-inspect_required': 'sent back',
}
const YOURS_LABEL: Record<NonNullable<InspectionOverviewItem['yours']>, string> = {
  verify: 'verify',
  fix: 'fix & resubmit',
  inspect: 'inspect',
}

interface Props {
  overview: InspectionOverview
  /** Set on a project page: counts link to the project's filtered list and the project name is not repeated. */
  projectId?: string
}

/**
 * Inspections at a glance: how many are open, awaiting verification, sent back and certified,
 * what is waiting on the signed-in person, and the most recently active open ones.
 */
export default function InspectionsOverviewPanel({ overview, projectId }: Props) {
  const { counts, waitingOnYou, recent, truncated } = overview
  const total = counts.open + counts.awaiting + counts.sentBack + counts.certified
  const listHref = (status?: string) =>
    projectId ? `/projects/${projectId}/inspections${status ? `?status=${status}` : ''}` : null

  const tiles: Array<{ label: string; value: number; status?: string; tone?: string }> = [
    { label: 'Open', value: counts.open },
    { label: 'Awaiting verification', value: counts.awaiting, status: 'awaiting_verification', tone: counts.awaiting ? 'var(--c-amber)' : undefined },
    { label: 'Sent back', value: counts.sentBack, status: 're-inspect_required', tone: counts.sentBack ? 'var(--c-red)' : undefined },
    { label: 'Certified', value: counts.certified, status: 'certified' },
  ]

  const row = (i: InspectionOverviewItem) => (
    <li key={i.id} style={{ display: 'flex', gap: 8, alignItems: 'baseline', fontSize: 12, minWidth: 0 }}>
      <Link
        href={`/projects/${i.project_id}/inspections/${i.id}`}
        style={{ color: 'var(--c-text)', textDecoration: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}
      >
        {i.target_label}
        {!projectId && i.project_name ? <span style={{ color: 'var(--c-text-dim)' }}> · {i.project_name}</span> : null}
      </Link>
      <span style={{ marginLeft: 'auto', flexShrink: 0, fontSize: 11, color: i.yours ? 'var(--c-amber)' : 'var(--c-text-dim)' }}>
        {i.yours ? YOURS_LABEL[i.yours] : STATUS_LABEL[i.status] ?? i.status}
      </span>
    </li>
  )

  return (
    <div className="data-panel" style={{ padding: 16, marginBottom: 16 }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
        <ClipboardCheck size={16} color="var(--c-text-dim)" />
        <span className="data-panel-title">Inspections</span>
        {projectId && (
          <Link href={`/projects/${projectId}/inspections`} style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--c-amber)', textDecoration: 'none' }}>
            View all →
          </Link>
        )}
      </div>

      <div className="stack-on-phone" style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 12, marginBottom: total ? 14 : 0 }}>
        {tiles.map((t) => {
          const href = listHref(t.status)
          const body = (
            <>
              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--c-text-dim)' }}>
                {t.label}
              </div>
              <div style={{ fontSize: 22, fontWeight: 600, color: t.tone ?? 'var(--c-text)' }}>{t.value}</div>
            </>
          )
          return href ? (
            <Link key={t.label} href={href} style={{ textDecoration: 'none', color: 'inherit' }}>
              {body}
            </Link>
          ) : (
            <div key={t.label}>{body}</div>
          )
        })}
      </div>

      {total === 0 ? (
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>No inspections yet.</p>
      ) : (
        <div className="stack-on-phone" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 6 }}>Waiting on you</div>
            {waitingOnYou.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>Nothing waiting on you.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{waitingOnYou.map(row)}</ul>
            )}
          </div>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--c-text-dim)', marginBottom: 6 }}>Recently active</div>
            {recent.length === 0 ? (
              <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>No open inspections.</p>
            ) : (
              <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>{recent.map(row)}</ul>
            )}
          </div>
        </div>
      )}
      {truncated && (
        <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '10px 0 0' }}>Counts cover the 1,000 most recently active inspections.</p>
      )}
    </div>
  )
}
