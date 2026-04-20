import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@esite/shared'
import { MessageSquare } from 'lucide-react'
import Link from 'next/link'

export const metadata: Metadata = { title: 'RFIs' }

interface Props {
  searchParams: Promise<{ projectId?: string }>
}

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const statusBadge = (s: string) => ({
  draft:     'badge badge-muted',
  open:      'badge badge-red',
  responded: 'badge badge-amber',
  closed:    'badge badge-green',
}[s] ?? 'badge badge-muted')

export default async function RfisPage({ searchParams }: Props) {
  const { projectId } = await searchParams
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  let q: any = membership
    ? supabase
        .schema('projects')
        .from('rfis')
        .select('*, project:projects!project_id(id, name)')
        .eq('organisation_id', membership.organisation_id)
        .order('created_at', { ascending: false })
    : null

  if (q && projectId) q = q.eq('project_id', projectId)

  const rawRfis: any[] = q ? ((await q).data ?? []) : []

  const { data: profileRows } = rawRfis.length
    ? await supabase
        .from('profiles')
        .select('id, full_name')
        .in('id', [...new Set(rawRfis.map((r: any) => r.raised_by).filter(Boolean))] as string[])
    : { data: [] }
  const profileMap = Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))
  const rfis = rawRfis.map((r: any) => ({
    ...r,
    raised_by_profile: r.raised_by ? (profileMap[r.raised_by] ?? null) : null,
  }))

  const projectName = rfis[0]?.project?.name ?? null

  return (
    <div className="animate-fadeup">
      {projectId && (
        <div style={{ marginBottom: 16 }}>
          <Link
            href={`/projects/${projectId}`}
            style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
          >
            ← {projectName ?? 'Project'}
          </Link>
        </div>
      )}

      <div className="page-header">
        <div>
          <h1 className="page-title">RFIs</h1>
          <p className="page-subtitle">
            {rfis.length} request{rfis.length !== 1 ? 's' : ''}
            {projectId && projectName ? ` · ${projectName}` : ''}
          </p>
        </div>
        <Link href={projectId ? `/rfis/new?projectId=${projectId}` : '/rfis/new'} className="btn-primary-amber">
          + New RFI
        </Link>
      </div>

      {rfis.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '64px 18px' }}>
            <MessageSquare size={28} style={{ margin: '0 auto 12px', opacity: 0.25, display: 'block' }} />
            No RFIs yet — requests for information raised on projects will appear here.
          </div>
        </div>
      ) : (
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">
              {projectId ? `${projectName ?? 'Project'} RFIs` : 'All RFIs'}
            </span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {rfis.length} total
            </span>
          </div>
          {rfis.map((rfi: any) => (
            <Link
              key={rfi.id}
              href={`/rfis/${rfi.id}${projectId ? `?projectId=${projectId}` : ''}`}
              className="data-panel-row"
              style={{ gap: 12 }}
            >
              <span
                className={priorityClass(rfi.priority)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0, width: 32 }}
              >
                {rfi.priority?.slice(0, 4) ?? '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {rfi.subject}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                  {!projectId && rfi.project?.name ? `${rfi.project.name} · ` : ''}
                  {rfi.raised_by_profile ? `${rfi.raised_by_profile.full_name} · ` : ''}
                  {formatDate(rfi.created_at)}
                  {rfi.due_date ? ` · due ${formatDate(rfi.due_date)}` : ''}
                </div>
              </div>
              <span className={statusBadge(rfi.status)}>{rfi.status}</span>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
