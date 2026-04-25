import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { projectService, formatZAR, getSlaSummary, SLA_DEFAULTS } from '@esite/shared'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Dashboard' }
import { FolderPlus, AlertTriangle, BookOpen, ShoppingBag, Clock, FileWarning, MessageSquareWarning } from 'lucide-react'

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

  const [stats, projects, recentSnags, ordersResult, ordersCountResult, deadlinesResult, complianceResult, sla] = await Promise.all([
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
          .select('id, title, priority, status, created_at, project_id')
          .eq('organisation_id', orgId)
          .in('status', ['open', 'in_progress'])
          .order('created_at', { ascending: false })
          .limit(5)
          .then((r: any) => r)
          .catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),

    orgId
      ? (supabase as any)
          .schema('marketplace')
          .from('orders')
          .select('id, status, total_amount, created_at, supplier_org_id')
          .eq('contractor_org_id', orgId)
          .not('status', 'in', '("draft","cancelled")')
          .order('created_at', { ascending: false })
          .limit(5)
          .then((r: any) => r)
          .catch(() => ({ data: [] }))
      : Promise.resolve({ data: [] }),

    orgId
      ? (supabase as any)
          .schema('marketplace')
          .from('orders')
          .select('id', { count: 'exact', head: true })
          .eq('contractor_org_id', orgId)
          .not('status', 'in', '("draft","cancelled")')
          .then((r: any) => r)
          .catch(() => ({ count: 0 }))
      : Promise.resolve({ count: 0 }),

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

    orgId
      ? getSlaSummary(supabase as any, orgId)
      : Promise.resolve({
          agingSnags: { count: 0, top: [] },
          pendingCocs: { count: 0, top: [] },
          staleRfis: { count: 0, top: [] },
        }),
  ])

  const activeOrders = ordersCountResult.count ?? 0
  const deadlines = deadlinesResult.count ?? 0

  // Fetch supplier org names separately (avoids cross-schema FK join)
  const ordersList = ordersResult.data ?? []
  const supplierOrgIds = [...new Set(ordersList.map((o: any) => o.supplier_org_id).filter(Boolean))] as string[]
  const { data: supplierOrgs } = supplierOrgIds.length
    ? await supabase.from('organisations').select('id, name').in('id', supplierOrgIds)
    : { data: [] }
  const supplierOrgMap = Object.fromEntries((supplierOrgs ?? []).map((o: any) => [o.id, o.name]))

  const snagsList = recentSnags.data ?? []
  const snagProjectIds = [...new Set(snagsList.map((s: any) => s.project_id).filter(Boolean))]
  const { data: snagProjects } = snagProjectIds.length
    ? await (supabase as any).schema('projects').from('projects').select('id, name').in('id', snagProjectIds)
    : { data: [] }
  const snagProjectMap = Object.fromEntries((snagProjects ?? []).map((p: any) => [p.id, p.name]))

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
        <Link href="/projects/new" className="btn-primary-amber">
          + New Project
        </Link>
      </div>

      {/* KPI row */}
      <div className="kpi-grid animate-fadeup animate-fadeup-1">
        <Link href="/projects" className="kpi-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="kpi-label">Active Projects</div>
          <div className="kpi-value">{stats.activeProjects}</div>
        </Link>

        <Link
          href="/snags"
          className={`kpi-card ${stats.openSnags > 10 ? 'kpi-danger' : stats.openSnags > 0 ? 'kpi-warning' : ''}`}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="kpi-label">Open Snags</div>
          <div className="kpi-value">{stats.openSnags}</div>
          {stats.openSnags > 0 && <div className="kpi-meta">Needs attention</div>}
        </Link>

        <Link
          href="/compliance"
          className={`kpi-card ${stats.pendingCocs > 0 ? 'kpi-warning' : ''}`}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="kpi-label">Pending COCs</div>
          <div className="kpi-value">{stats.pendingCocs}</div>
        </Link>

        <Link href="/marketplace/orders" className="kpi-card" style={{ textDecoration: 'none', color: 'inherit' }}>
          <div className="kpi-label">Active Orders</div>
          <div className="kpi-value">{activeOrders}</div>
        </Link>

        <Link
          href="/compliance"
          className={`kpi-card ${complianceVariant}`}
          style={{ textDecoration: 'none', color: 'inherit' }}
        >
          <div className="kpi-label">Compliance</div>
          <div className="kpi-value">
            {complianceHealth !== null ? `${complianceHealth}%` : '—'}
          </div>
          {allSubs.length > 0 && (
            <div className="kpi-meta">{compliantSubs}/{allSubs.length} sections</div>
          )}
        </Link>
      </div>

      {/* Operational SLA — surfaces stuck/aging work the org needs to act on */}
      {(sla.agingSnags.count > 0 || sla.pendingCocs.count > 0 || sla.staleRfis.count > 0) && (
        <div className="animate-fadeup animate-fadeup-2" style={{ marginBottom: 16 }}>
          <div style={{
            display: 'flex', alignItems: 'baseline', justifyContent: 'space-between',
            marginBottom: 10,
          }}>
            <h2 style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
              letterSpacing: '0.08em', textTransform: 'uppercase', margin: 0,
            }}>
              Action required
            </h2>
            <span style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>
              snags &gt;{SLA_DEFAULTS.AGING_SNAG_DAYS}d · rfis &gt;{SLA_DEFAULTS.STALE_RFI_DAYS}d / overdue
            </span>
          </div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: 16 }}>
            {/* Aging snags */}
            <Link
              href="/snags?filter=aging"
              className="data-panel"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: 16 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <Clock size={16} color={sla.agingSnags.count > 0 ? 'var(--c-amber)' : 'var(--c-text-dim)'} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  Aging snags
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 600, color: 'var(--c-text)' }}>
                  {sla.agingSnags.count}
                </span>
              </div>
              {sla.agingSnags.top.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>
                  No snags have been open longer than {SLA_DEFAULTS.AGING_SNAG_DAYS} days.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sla.agingSnags.top.map(s => (
                    <li key={s.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {s.title}
                      </span>
                      <span style={{ color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {s.days_open}d
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Link>

            {/* Pending COCs */}
            <Link
              href="/compliance?filter=pending"
              className="data-panel"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: 16 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <FileWarning size={16} color={sla.pendingCocs.count > 0 ? 'var(--c-amber)' : 'var(--c-text-dim)'} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  Pending COCs
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 600, color: 'var(--c-text)' }}>
                  {sla.pendingCocs.count}
                </span>
              </div>
              {sla.pendingCocs.top.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>
                  No COCs awaiting review.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sla.pendingCocs.top.map(c => (
                    <li key={c.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {c.name}
                      </span>
                      <span style={{ color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap' }}>
                        {c.coc_status === 'submitted' ? 'new' : 'review'}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Link>

            {/* Stale RFIs */}
            <Link
              href="/rfis?filter=stale"
              className="data-panel"
              style={{ textDecoration: 'none', color: 'inherit', display: 'block', padding: 16 }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                <MessageSquareWarning size={16} color={sla.staleRfis.count > 0 ? 'var(--c-amber)' : 'var(--c-text-dim)'} />
                <span style={{
                  fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)',
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                }}>
                  Stale RFIs
                </span>
                <span style={{ marginLeft: 'auto', fontSize: 22, fontWeight: 600, color: 'var(--c-text)' }}>
                  {sla.staleRfis.count}
                </span>
              </div>
              {sla.staleRfis.top.length === 0 ? (
                <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: 0 }}>
                  No RFIs are overdue or stale.
                </p>
              ) : (
                <ul style={{ listStyle: 'none', padding: 0, margin: 0, display: 'flex', flexDirection: 'column', gap: 6 }}>
                  {sla.staleRfis.top.map(r => (
                    <li key={r.id} style={{ fontSize: 12, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                      <span style={{ color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                        {r.subject}
                      </span>
                      <span style={{
                        color: r.is_overdue ? 'var(--c-red)' : 'var(--c-text-dim)',
                        fontFamily: 'var(--font-mono)', fontSize: 11, whiteSpace: 'nowrap',
                      }}>
                        {r.is_overdue ? 'overdue' : `${r.days_open}d`}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </Link>
          </div>
        </div>
      )}

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
                        color: days <= 7 ? 'var(--c-red)' : days <= 14 ? 'var(--c-orange)' : 'var(--c-text-dim)',
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
                    {snagProjectMap[s.project_id] ?? '—'}
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
          <Link href="/marketplace" className="data-panel-link">View all →</Link>
        </div>
        {ordersList.length === 0 ? (
          <div className="data-panel-empty">No active orders</div>
        ) : (
          ordersList.map((o: any) => (
            <Link key={o.id} href={`/marketplace/orders/${o.id}`} className="data-panel-row">
              <div>
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                  {supplierOrgMap[o.supplier_org_id] ?? 'Supplier'}
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
          { href: '/projects/new', label: 'New Project',  Icon: () => <FolderPlus    size={18} aria-hidden="true" /> },
          { href: '/snags/new',    label: 'Log Snag',     Icon: () => <AlertTriangle size={18} aria-hidden="true" /> },
          { href: '/diary',        label: 'Site Diary',   Icon: () => <BookOpen      size={18} aria-hidden="true" /> },
          { href: '/marketplace',  label: 'Marketplace',  Icon: () => <ShoppingBag   size={18} aria-hidden="true" /> },
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
