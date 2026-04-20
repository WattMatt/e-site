import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, snagService, formatDate } from '@esite/shared'

interface Props { params: Promise<{ id: string }>; searchParams: Promise<{ status?: string }> }

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const statusBadge = (s: string) => ({
  open:             'badge badge-red',
  in_progress:      'badge badge-blue',
  pending_sign_off: 'badge badge-amber',
  resolved:         'badge badge-green',
  signed_off:       'badge badge-green',
  closed:           'badge badge-muted',
}[s] ?? 'badge badge-muted')

export default async function ProjectSnagsPage({ params, searchParams }: Props) {
  const { id: projectId } = await params
  const { status } = await searchParams
  const supabase = await createClient()

  const project = await projectService.getById(supabase as any, projectId).catch(() => null)
  if (!project) notFound()

  const allSnags = await snagService.list(supabase as any, projectId).catch(() => [])
  const snags = status ? allSnags.filter(s => s.status === status) : allSnags

  const stats = allSnags.reduce((acc: Record<string, number>, s) => {
    acc[s.status] = (acc[s.status] ?? 0) + 1
    return acc
  }, {})

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link href={`/projects/${projectId}`} style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}>
          ← {project.name}
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">Snags</h1>
          <p className="page-subtitle">{project.name}</p>
        </div>
        <Link href={`/projects/${projectId}/snags/new`} className="btn-primary-amber">+ New Snag</Link>
      </div>

      {/* Status filter pills */}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 20 }}>
        <Link
          href={`/projects/${projectId}/snags`}
          className={`filter-tab${!status ? ' active' : ''}`}
        >
          All ({allSnags.length})
        </Link>
        {Object.entries(stats).map(([s, count]) => (
          <Link
            key={s}
            href={status === s ? `/projects/${projectId}/snags` : `/projects/${projectId}/snags?status=${s}`}
            className={`filter-tab${status === s ? ' active' : ''}`}
            style={{ textTransform: 'capitalize' }}
          >
            {s.replace(/_/g, ' ')} ({count})
          </Link>
        ))}
      </div>

      {snags.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
            No snags{status ? ` with status "${status.replace(/_/g, ' ')}"` : ''} — all clear
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              {status ? status.replace(/_/g, ' ') : 'All Snags'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {snags.length} snag{snags.length !== 1 ? 's' : ''}
            </span>
          </div>
          {snags.map((snag) => {
            const raisedBy = (snag as any).raised_by_profile
            const assignedTo = (snag as any).assigned_to_profile
            return (
              <Link key={snag.id} href={`/snags/${snag.id}`} className="data-panel-row" style={{ alignItems: 'flex-start', gap: 12 }}>
                <span
                  className={priorityClass(snag.priority)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 3, flexShrink: 0, width: 32 }}
                >
                  {snag.priority?.slice(0, 4) ?? '—'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {snag.title}
                  </div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 3, display: 'flex', flexWrap: 'wrap', gap: '0 12px' }}>
                    {snag.location && <span>📍 {snag.location}</span>}
                    {raisedBy && <span>By {raisedBy.full_name}</span>}
                    {assignedTo && <span>→ {assignedTo.full_name}</span>}
                    <span>{formatDate(snag.created_at)}</span>
                  </div>
                </div>
                <span className={statusBadge(snag.status)} style={{ marginTop: 2 }}>
                  {snag.status.replace(/_/g, ' ')}
                </span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
