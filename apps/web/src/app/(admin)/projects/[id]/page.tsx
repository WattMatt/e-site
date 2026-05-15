import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { projectService, snagService, rfiService, formatDate, formatZAR, getProjectCommittedSpend } from '@esite/shared'
import { ReportButton } from '@/components/ui/ReportButton'
import { DeleteProjectPanel } from './DeleteProjectPanel'

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

  const [project, snagStats, snags, rfis, spend] = await Promise.all([
    projectService.getById(supabase as any, id).catch(() => null),
    snagService.getStats(supabase as any, id),
    snagService.list(supabase as any, id).catch(() => []),
    rfiService.list(supabase as any, id).catch(() => []),
    getProjectCommittedSpend(supabase as any, id),
  ])

  if (!project) notFound()

  const openRfis = rfis.filter((r) => r.status === 'open').length

  // Owner-only delete gate — fetch the current user's role on this org so
  // the danger-zone panel renders only for owners. Server action re-checks.
  const { data: { user } } = await supabase.auth.getUser()
  let isOwner = false
  if (user) {
    const { data: membership } = await supabase
      .from('user_organisations')
      .select('role')
      .eq('user_id', user.id)
      .eq('organisation_id', (project as any).organisation_id)
      .eq('is_active', true)
      .maybeSingle()
    isOwner = membership?.role === 'owner'
  }

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

      {/* Budget bar — visible whenever there's any scheduled or committed value
          to show. Budget is set via the project edit form (project.budget_amount). */}
      {((project as any).budget_amount || spend.scheduledValue > 0 || spend.committed > 0) && (
        <div className="data-panel animate-fadeup animate-fadeup-1" style={{ padding: 16, marginBottom: 16 }}>
          <BudgetBar
            budget={Number((project as any).budget_amount ?? 0)}
            scheduled={spend.scheduledValue}
            committed={spend.committed}
            ordered={spend.ordered}
            delivered={spend.delivered}
          />
        </div>
      )}

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

      {/* Danger zone — owner-only hard delete */}
      {isOwner && (
        <DeleteProjectPanel projectId={id} projectName={project.name} />
      )}
    </div>
  )
}

/**
 * BudgetBar — stacked progress bar showing scheduled (engineer's est) /
 * committed (selected quotes + approved + fulfilled) / ordered (approved +
 * fulfilled) / delivered (fulfilled) against the project's budget_amount.
 * When budget is 0, scales against MAX(scheduled, committed) so the bar
 * still tells a story.
 */
function BudgetBar({
  budget, scheduled, committed, ordered, delivered,
}: {
  budget: number
  scheduled: number
  committed: number
  ordered: number
  delivered: number
}) {
  const denominator = Math.max(budget, scheduled, committed, 1)
  const pct = (n: number) => Math.min(100, Math.round((n / denominator) * 100))
  const overBudget = budget > 0 && committed > budget
  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 8 }}>
        <div>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 600, letterSpacing: '0.12em',
            textTransform: 'uppercase', color: 'var(--c-text-dim)',
          }}>
            Procurement budget
          </div>
          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--c-text)', marginTop: 2 }}>
            {budget > 0 ? formatZAR(budget) : 'No budget set'}
            {overBudget && (
              <span style={{ marginLeft: 10, fontSize: 12, color: '#dc2626' }}>
                · over by {formatZAR(committed - budget)}
              </span>
            )}
          </div>
        </div>
        <div style={{ textAlign: 'right', fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)' }}>
          {scheduled > 0 && <div>Scheduled: {formatZAR(scheduled)}</div>}
          {committed > 0 && <div>Committed: {formatZAR(committed)}</div>}
          {delivered > 0 && <div>Delivered: {formatZAR(delivered)}</div>}
        </div>
      </div>
      <div style={{
        position: 'relative', height: 12, background: 'var(--c-base)',
        borderRadius: 6, overflow: 'hidden', border: '1px solid var(--c-border)',
      }}>
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct(committed)}%`, background: overBudget ? '#dc2626' : 'var(--c-amber-mid)',
        }} />
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct(ordered)}%`, background: 'var(--c-amber)',
        }} />
        <div style={{
          position: 'absolute', top: 0, left: 0, height: '100%',
          width: `${pct(delivered)}%`, background: '#16a34a',
        }} />
      </div>
      <div style={{
        display: 'flex', gap: 14, marginTop: 6, fontFamily: 'var(--font-mono)',
        fontSize: 10, color: 'var(--c-text-dim)', flexWrap: 'wrap',
      }}>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--c-amber-mid)', borderRadius: 2 }} /> Committed
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: 'var(--c-amber)', borderRadius: 2 }} /> Ordered
        </span>
        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
          <span style={{ width: 10, height: 10, background: '#16a34a', borderRadius: 2 }} /> Delivered
        </span>
      </div>
    </div>
  )
}
