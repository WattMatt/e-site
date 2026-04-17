import { createClient } from '@/lib/supabase/server'
import { projectService, formatZAR } from '@esite/shared'
import Link from 'next/link'

/* ── Quick action icons ─────────────────────────────────────── */
function IconNewProject() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <path d="M3 5h6l2-3h6v15H3z" />
      <line x1="10" y1="9" x2="10" y2="15" />
      <line x1="7" y1="12" x2="13" y2="12" />
    </svg>
  )
}

function IconSnag() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <path d="M10 2L18 16H2L10 2z" />
      <line x1="10" y1="8" x2="10" y2="12" />
      <circle cx="10" cy="14.5" r="0.8" fill="currentColor" stroke="none" />
    </svg>
  )
}

function IconDiary() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <rect x="3" y="2" width="14" height="16" rx="1" />
      <line x1="7" y1="7" x2="13" y2="7" />
      <line x1="7" y1="10" x2="13" y2="10" />
      <line x1="7" y1="13" x2="10" y2="13" />
    </svg>
  )
}

function IconMarket() {
  return (
    <svg viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.5" width="18" height="18">
      <path d="M2 7l2-4h12l2 4" />
      <path d="M2 7h16v.5a2.5 2.5 0 01-5 0 2.5 2.5 0 01-5 0A2.5 2.5 0 012 7.5V7z" />
      <rect x="2" y="8" width="16" height="10" rx="0.5" />
      <rect x="7.5" y="13" width="5" height="5" />
    </svg>
  )
}

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role, organisation:organisations(name)')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = membership?.organisation_id

  const [stats, projects, recentSnags, ordersResult, deadlinesResult, complianceResult] = await Promise.all([
    orgId
      ? projectService.getStats(supabase as any, orgId)
      : Promise.resolve({ activeProjects: 0, openSnags: 0, pendingCocs: 0 }),

    orgId
      ? (supabase as any)
          .schema('projects')
          .from('projects')
          .select('id, name, status, end_date, city, client_name')
          .eq('organisation_id', orgId)
          .eq('status', 'active')
          .not('end_date', 'is', null)
          .order('end_date', { ascending: true })
          .limit(5)
      : Promise.resolve({ data: [] }),

    orgId
      ? (supabase as any)
          .schema('field')
          .from('snags')
          .select('id, title, priority, status, created_at, project:projects!project_id(name)')
          .eq('organisation_id', orgId)
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),

    orgId
      ? (supabase as any)
          .schema('marketplace')
          .from('orders')
          .select('id, status, total_amount, created_at, supplier:suppliers.suppliers!supplier_id(name)')
          .eq('contractor_org_id', orgId)
          .not('status', 'in', '("draft","cancelled")')
          .order('created_at', { ascending: false })
          .limit(5)
      : Promise.resolve({ data: [] }),

    orgId
      ? (supabase as any)
          .schema('projects')
          .from('projects')
          .select('id', { count: 'exact', head: true })
          .eq('organisation_id', orgId)
          .eq('status', 'active')
          .not('end_date', 'is', null)
          .lte('end_date', new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString().split('T')[0])
      : Promise.resolve({ count: 0 }),

    orgId
      ? (supabase as any)
          .schema('compliance')
          .from('subsections')
          .select('coc_status')
          .eq('organisation_id', orgId)
      : Promise.resolve({ data: [] }),
  ])

  const activeOrders = ordersResult.data?.length ?? 0
  const deadlines = deadlinesResult.count ?? 0

  const allSubs = complianceResult.data ?? []
  const compliantSubs = allSubs.filter((s: any) => s.coc_status === 'approved').length
  const complianceHealth = allSubs.length > 0
    ? Math.round((compliantSubs / allSubs.length) * 100)
    : null

  const today = new Date()
  const orgName = (membership?.organisation as any)?.name ?? 'E-Site'

  const priorityClass = (p: string) => ({
    critical: 'priority-critical',
    high: 'priority-high',
    medium: 'priority-medium',
    low: 'priority-low',
  }[p] ?? 'priority-low')

  const orderBadge = (s: string) => ({
    submitted:  'badge badge-blue',
    confirmed:  'badge badge-amber',
    in_transit: 'badge badge-amber',
    delivered:  'badge badge-green',
    invoiced:   'badge badge-muted',
  }[s] ?? 'badge badge-muted')

  const daysUntil = (dateStr: string) =>
    Math.ceil((new Date(dateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))

  const complianceVariant =
    complianceHealth === null ? '' :
    complianceHealth >= 80 ? 'kpi-success' :
    complianceHealth >= 50 ? 'kpi-warning' :
    'kpi-danger'

  return (
    <div className="animate-fadeup">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Dashboard</h1>
          <p className="page-subtitle">{orgName}</p>
        </div>
        <Link
          href="/projects/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            background: 'var(--c-amber)',
            color: '#0D0B09',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
            letterSpacing: '0.01em',
          }}
        >
          + New Project
        </Link>
      </div>

      {/* KPI row */}
      <div className="kpi-grid animate-fadeup animate-fadeup-1">
        <div className={`kpi-card ${stats.openSnags > 10 ? 'kpi-danger' : stats.openSnags > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Active Projects</div>
          <div className="kpi-value">{stats.activeProjects}</div>
        </div>

        <div className={`kpi-card ${stats.openSnags > 10 ? 'kpi-danger' : stats.openSnags > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Open Snags</div>
          <div className="kpi-value">{stats.openSnags}</div>
          {stats.openSnags > 0 && <div className="kpi-meta">Needs attention</div>}
        </div>

        <div className={`kpi-card ${stats.pendingCocs > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-label">Pending COCs</div>
          <div className="kpi-value">{stats.pendingCocs}</div>
        </div>

        <div className="kpi-card">
          <div className="kpi-label">Active Orders</div>
          <div className="kpi-value">{activeOrders}</div>
        </div>

        <div className={`kpi-card ${complianceVariant}`}>
          <div className="kpi-label">Compliance</div>
          <div className="kpi-value">
            {complianceHealth !== null ? `${complianceHealth}%` : '—'}
          </div>
          {allSubs.length > 0 && (
            <div className="kpi-meta">{compliantSubs}/{allSubs.length} sections</div>
          )}
        </div>
      </div>

      {/* Two-column grid */}
      <div
        className="animate-fadeup animate-fadeup-2"
        style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginBottom: 16 }}
      >
        {/* Upcoming deadlines */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Upcoming Deadlines</span>
            {deadlines > 0 && (
              <span className="badge badge-amber">{deadlines} within 30d</span>
            )}
          </div>
          {(projects.data ?? []).length === 0 ? (
            <div className="data-panel-empty">No active projects with deadlines</div>
          ) : (
            <>
              {(projects.data ?? []).slice(0, 5).map((p: any) => {
                const days = daysUntil(p.end_date)
                return (
                  <Link key={p.id} href={`/projects/${p.id}`} className="data-panel-row">
                    <div>
                      <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.3 }}>{p.name}</div>
                      <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                        {p.client_name ?? p.city ?? '—'}
                      </div>
                    </div>
                    <span
                      style={{
                        fontFamily: 'var(--font-mono)',
                        fontSize: 12,
                        fontWeight: 700,
                        color: days < 0 ? 'var(--c-red)' : days <= 7 ? 'var(--c-red)' : days <= 14 ? '#F08030' : 'var(--c-text-dim)',
                        whiteSpace: 'nowrap',
                      }}
                    >
                      {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Today' : `${days}d`}
                    </span>
                  </Link>
                )
              })}
              <div className="data-panel-footer">
                <Link href="/projects" className="data-panel-link">View all projects →</Link>
              </div>
            </>
          )}
        </div>

        {/* Open snags */}
        <div className="data-panel">
          <div className="data-panel-header">
            <span className="data-panel-title">Open Snags</span>
            <Link href="/snags" className="data-panel-link">View all →</Link>
          </div>
          {(recentSnags.data ?? []).length === 0 ? (
            <div className="data-panel-empty">No open snags — all clear</div>
          ) : (
            (recentSnags.data ?? []).map((s: any) => (
              <Link key={s.id} href={`/snags/${s.id}`} className="data-panel-row" style={{ alignItems: 'flex-start', gap: 10 }}>
                <span
                  className={priorityClass(s.priority)}
                  style={{ fontFamily: 'var(--font-mono)', fontSize: 9, fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginTop: 3 }}
                >
                  {s.priority?.slice(0, 4) ?? '—'}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 13, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.title}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {(s.project as any)?.name ?? '—'}
                  </div>
                </div>
                <span className={s.status === 'in_progress' ? 'badge badge-blue' : 'badge badge-muted'}>
                  {s.status === 'in_progress' ? 'In progress' : 'Open'}
                </span>
              </Link>
            ))
          )}
        </div>
      </div>

      {/* Marketplace orders */}
      <div className="data-panel animate-fadeup animate-fadeup-3" style={{ marginBottom: 16 }}>
        <div className="data-panel-header">
          <span className="data-panel-title">Active Marketplace Orders</span>
          <Link href="/marketplace/orders" className="data-panel-link">View all →</Link>
        </div>
        {(ordersResult.data ?? []).length === 0 ? (
          <div className="data-panel-empty">No active orders</div>
        ) : (
          (ordersResult.data ?? []).map((o: any) => (
            <Link key={o.id} href={`/marketplace/orders/${o.id}`} className="data-panel-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                  {(o.supplier as any)?.name ?? 'Supplier'}
                </div>
                <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                  {new Date(o.created_at).toLocaleDateString('en-ZA')}
                </div>
              </div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                {o.total_amount != null && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 13, fontWeight: 700, color: 'var(--c-text)' }}>
                    {formatZAR(o.total_amount)}
                  </span>
                )}
                <span className={orderBadge(o.status)}>
                  {o.status.replace('_', ' ')}
                </span>
              </div>
            </Link>
          ))
        )}
      </div>

      {/* Quick actions */}
      <div className="quick-actions animate-fadeup animate-fadeup-4">
        {[
          { href: '/projects/new', label: 'New Project',  Icon: IconNewProject },
          { href: '/snags/new',    label: 'Log Snag',     Icon: IconSnag },
          { href: '/diary',        label: 'Site Diary',   Icon: IconDiary },
          { href: '/marketplace',  label: 'Marketplace',  Icon: IconMarket },
        ].map(({ href, label, Icon }) => (
          <Link key={href} href={href} className="quick-action">
            <div className="quick-action-icon">
              <Icon />
            </div>
            <span className="quick-action-label">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
