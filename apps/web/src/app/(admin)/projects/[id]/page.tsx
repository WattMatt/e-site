import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, snagService, rfiService, formatDate, formatZAR } from '@esite/shared'
import { ReportButton } from '@/components/ui/ReportButton'

interface Props {
  params: Promise<{ id: string }>
}

const priorityClass = (p: string) => ({
  critical: 'priority-critical',
  high:     'priority-high',
  medium:   'priority-medium',
  low:      'priority-low',
}[p] ?? 'priority-low')

const snagBadge = (s: string) => ({
  open:             'badge badge-red',
  in_progress:      'badge badge-blue',
  pending_sign_off: 'badge badge-amber',
  resolved:         'badge badge-green',
  signed_off:       'badge badge-green',
  closed:           'badge badge-muted',
}[s] ?? 'badge badge-muted')

const statusBadge = (s: string) => ({
  active:    'badge badge-green',
  completed: 'badge badge-blue',
  on_hold:   'badge badge-amber',
  cancelled: 'badge badge-muted',
}[s] ?? 'badge badge-muted')

const rfiBadge = (s: string) => ({
  draft:     'badge badge-muted',
  open:      'badge badge-red',
  responded: 'badge badge-amber',
  closed:    'badge badge-green',
}[s] ?? 'badge badge-muted')

export default async function ProjectDetailPage({ params }: Props) {
  const { id } = await params
  const supabase = await createClient()

  const [project, snagStats, snags, rfis] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    snagService.getStats(supabase as any, id),
    snagService.list(supabase as any, id).catch(() => []),
    rfiService.list(supabase as any, id).catch(() => []),
  ])

  if (!project) notFound()

  const openRfis = rfis.filter((r) => r.status === 'open').length

  return (
    <div className="animate-fadeup">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{project.name}</h1>
          <p className="page-subtitle">
            {project.city ?? ''}
            {project.province ? `, ${project.province}` : ''}
          </p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <span className={statusBadge(project.status)}>{project.status.replace('_', ' ')}</span>
          <ReportButton type="snag-list" entityId={id} label="↓ Snag Report" />
          <Link href={`/projects/${id}/snags/new`} className="btn-primary-amber">+ Snag</Link>
        </div>
      </div>

      {/* KPIs */}
      <div className="kpi-grid animate-fadeup animate-fadeup-1">
        <div className={`kpi-card ${(snagStats.open + snagStats.in_progress) > 0 ? 'kpi-danger' : ''}`}>
          <div className="kpi-label">Open Snags</div>
          <div className="kpi-value">{snagStats.open + snagStats.in_progress}</div>
        </div>
        <div className={`kpi-card ${snagStats.pending_sign_off > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Pending Sign-off</div>
          <div className="kpi-value">{snagStats.pending_sign_off}</div>
        </div>
        <div className="kpi-card kpi-success">
          <div className="kpi-label">Closed Snags</div>
          <div className="kpi-value">{snagStats.signed_off + snagStats.closed}</div>
        </div>
        <div className={`kpi-card ${openRfis > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Open RFIs</div>
          <div className="kpi-value">{openRfis}</div>
        </div>
      </div>

      {/* Two-column: details + recent snags */}
      <div
        className="animate-fadeup animate-fadeup-2"
        style={{ display: 'grid', gridTemplateColumns: '280px 1fr', gap: 16, marginBottom: 16 }}
      >
        {/* Project details */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Details</span>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexDirection: 'column', gap: 14 }}>
            {[
              ['Client', project.client_name],
              ['Contact', project.client_contact],
              ['Contract Value', project.contract_value ? formatZAR(project.contract_value) : null],
              ['Start Date', project.start_date ? formatDate(project.start_date) : null],
              ['End Date', project.end_date ? formatDate(project.end_date) : null],
            ].filter(([, v]) => v).map(([label, value]) => (
              <div key={label as string}>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 3 }}>
                  {label}
                </div>
                <div style={{ fontSize: 13, color: 'var(--c-text)' }}>{value}</div>
              </div>
            ))}
          </div>
        </div>

        {/* Recent snags */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Recent Snags</span>
            <Link href={`/projects/${id}/snags`} className="data-panel-link">View all →</Link>
          </div>
          {snags.length === 0 ? (
            <div className="data-panel-empty">No snags yet — all clear</div>
          ) : (
            snags.slice(0, 5).map((snag: any) => (
              <Link key={snag.id} href={`/snags/${snag.id}`} className="data-panel-row" style={{ gap: 10 }}>
                <span
                  className={priorityClass(snag.priority)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0, width: 32 }}
                >
                  {snag.priority?.slice(0, 4) ?? '—'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{snag.title}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>{formatDate(snag.created_at)}</div>
                </div>
                <span className={snagBadge(snag.status)}>{snag.status.replace(/_/g, ' ')}</span>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Recent RFIs */}
      {rfis.length > 0 && (
        <div className="data-panel animate-fadeup animate-fadeup-3" style={{ marginBottom: 16 }}>
          <div className="data-panel-header">
            <span className="data-panel-title">Recent RFIs</span>
            <Link href={`/rfis?projectId=${id}`} className="data-panel-link">View all →</Link>
          </div>
          {rfis.slice(0, 3).map((rfi) => (
            <Link key={rfi.id} href={`/rfis/${rfi.id}?projectId=${id}`} className="data-panel-row" style={{ gap: 10 }}>
              <span
                className={priorityClass(rfi.priority)}
                style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', flexShrink: 0, width: 32 }}
              >
                {rfi.priority?.slice(0, 4) ?? '—'}
              </span>
              <div style={{ flex: 1, minWidth: 0 }}>
                <div style={{ fontSize: 13, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{rfi.subject}</div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>{formatDate(rfi.created_at)}</div>
              </div>
              <span className={rfiBadge(rfi.status)}>{rfi.status}</span>
            </Link>
          ))}
        </div>
      )}

      {/* Team */}
      {(project.project_members as any[])?.length > 0 && (
        <div className="data-panel animate-fadeup animate-fadeup-4">
          <div className="data-panel-header">
            <span className="data-panel-title">Team</span>
            <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
              {(project.project_members as any[]).length} member{(project.project_members as any[]).length !== 1 ? 's' : ''}
            </span>
          </div>
          <div style={{ padding: '14px 18px', display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            {(project.project_members as any[]).map((m) => (
              <div
                key={m.id}
                style={{
                  display: 'flex', alignItems: 'center', gap: 8,
                  background: 'var(--c-elevated)', border: '1px solid var(--c-border)',
                  borderRadius: 20, padding: '5px 12px 5px 5px',
                }}
              >
                <div style={{
                  width: 24, height: 24, borderRadius: '50%',
                  background: 'var(--c-amber-mid)', border: '1px solid var(--c-amber)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 700, color: 'var(--c-amber)',
                  flexShrink: 0,
                }}>
                  {m.profile?.full_name?.[0] ?? '?'}
                </div>
                <div>
                  <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--c-text)' }}>{m.profile?.full_name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)', textTransform: 'uppercase', letterSpacing: '0.08em' }}>{m.role}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
