import { createClient } from '@/lib/supabase/server'
import { projectService, formatZAR } from '@esite/shared'
import { KpiCard } from '@/components/ui/Card'
import { PageHeader } from '@/components/layout/Header'
import Link from 'next/link'

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

    // Active projects for deadline list
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

    // Recent open snags
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

    // Active marketplace orders
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

    // Projects due within 30 days
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

    // Compliance: subsections with valid COC vs total
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

  // Compliance health %
  const allSubs = complianceResult.data ?? []
  const compliantSubs = allSubs.filter((s: any) => s.coc_status === 'approved').length
  const complianceHealth = allSubs.length > 0
    ? Math.round((compliantSubs / allSubs.length) * 100)
    : null

  const today = new Date()
  const priorityColor = (p: string) => ({
    critical: 'text-red-400',
    high: 'text-orange-400',
    medium: 'text-yellow-400',
    low: 'text-slate-400',
  }[p] ?? 'text-slate-400')

  const orderStatusColor = (s: string) => ({
    submitted: 'bg-blue-500/10 text-blue-400',
    confirmed: 'bg-indigo-500/10 text-indigo-400',
    in_transit: 'bg-amber-500/10 text-amber-400',
    delivered: 'bg-green-500/10 text-green-400',
    invoiced: 'bg-purple-500/10 text-purple-400',
  }[s] ?? 'bg-slate-700 text-slate-400')

  const daysUntil = (dateStr: string) => {
    const d = Math.ceil((new Date(dateStr).getTime() - today.getTime()) / (1000 * 60 * 60 * 24))
    return d
  }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={(membership?.organisation as any)?.name ?? 'E-Site'}
      />

      {/* KPI row */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-8">
        <KpiCard label="Active Projects" value={stats.activeProjects} />
        <KpiCard
          label="Open Snags"
          value={stats.openSnags}
          variant={stats.openSnags > 10 ? 'danger' : stats.openSnags > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Pending COCs"
          value={stats.pendingCocs}
          variant={stats.pendingCocs > 0 ? 'warning' : 'default'}
        />
        <KpiCard
          label="Active Orders"
          value={activeOrders}
        />
        <div className={`rounded-xl p-4 border ${
          complianceHealth === null ? 'bg-slate-800 border-slate-700' :
          complianceHealth >= 80 ? 'bg-green-950/40 border-green-800' :
          complianceHealth >= 50 ? 'bg-yellow-950/40 border-yellow-800' :
          'bg-red-950/40 border-red-800'
        }`}>
          <p className="text-xs text-slate-400 uppercase tracking-wide mb-1">Compliance Health</p>
          <p className={`text-2xl font-bold ${
            complianceHealth === null ? 'text-slate-400' :
            complianceHealth >= 80 ? 'text-green-400' :
            complianceHealth >= 50 ? 'text-yellow-400' :
            'text-red-400'
          }`}>
            {complianceHealth !== null ? `${complianceHealth}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">
            {allSubs.length > 0 ? `${compliantSubs} / ${allSubs.length} subsections` : 'No data'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 mb-6">
        {/* Upcoming deadlines */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Upcoming Deadlines</h2>
            {deadlines > 0 && (
              <span className="text-xs bg-amber-500/15 text-amber-400 px-2 py-0.5 rounded-full font-medium">
                {deadlines} within 30d
              </span>
            )}
          </div>
          {(projects.data ?? []).length === 0 ? (
            <p className="text-slate-500 text-sm px-5 py-6">No active projects with deadlines</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {(projects.data ?? []).slice(0, 5).map((p: any) => {
                const days = daysUntil(p.end_date)
                return (
                  <li key={p.id}>
                    <Link href={`/projects/${p.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/60 transition-colors">
                      <div>
                        <p className="text-sm font-medium text-white leading-tight">{p.name}</p>
                        <p className="text-xs text-slate-500">{p.client_name ?? p.city ?? '—'}</p>
                      </div>
                      <span className={`text-xs font-semibold tabular-nums ${
                        days <= 7 ? 'text-red-400' : days <= 14 ? 'text-orange-400' : 'text-slate-400'
                      }`}>
                        {days < 0 ? `${Math.abs(days)}d overdue` : days === 0 ? 'Due today' : `${days}d`}
                      </span>
                    </Link>
                  </li>
                )
              })}
            </ul>
          )}
          <div className="px-5 py-3 border-t border-slate-800">
            <Link href="/projects" className="text-xs text-blue-400 hover:text-blue-300">View all projects →</Link>
          </div>
        </div>

        {/* Recent open snags */}
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden">
          <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
            <h2 className="text-sm font-semibold text-white">Open Snags</h2>
            <Link href="/snags" className="text-xs text-blue-400 hover:text-blue-300">View all</Link>
          </div>
          {(recentSnags.data ?? []).length === 0 ? (
            <p className="text-slate-500 text-sm px-5 py-6">No open snags</p>
          ) : (
            <ul className="divide-y divide-slate-800">
              {(recentSnags.data ?? []).map((s: any) => (
                <li key={s.id}>
                  <Link href={`/snags/${s.id}`} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-800/60 transition-colors">
                    <span className={`text-xs font-bold uppercase mt-0.5 ${priorityColor(s.priority)}`}>
                      {s.priority?.slice(0, 4) ?? '—'}
                    </span>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm text-white truncate leading-tight">{s.title}</p>
                      <p className="text-xs text-slate-500">{(s.project as any)?.name ?? '—'}</p>
                    </div>
                    <span className={`text-xs px-1.5 py-0.5 rounded font-medium flex-shrink-0 ${
                      s.status === 'in_progress' ? 'bg-blue-500/10 text-blue-400' : 'bg-slate-700 text-slate-400'
                    }`}>
                      {s.status === 'in_progress' ? 'In progress' : 'Open'}
                    </span>
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      {/* Marketplace orders */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden mb-6">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800">
          <h2 className="text-sm font-semibold text-white">Active Marketplace Orders</h2>
          <Link href="/marketplace/orders" className="text-xs text-blue-400 hover:text-blue-300">View all</Link>
        </div>
        {(ordersResult.data ?? []).length === 0 ? (
          <p className="text-slate-500 text-sm px-5 py-6">No active orders</p>
        ) : (
          <ul className="divide-y divide-slate-800">
            {(ordersResult.data ?? []).map((o: any) => (
              <li key={o.id}>
                <Link href={`/marketplace/orders/${o.id}`} className="flex items-center justify-between px-5 py-3 hover:bg-slate-800/60 transition-colors">
                  <div>
                    <p className="text-sm text-white font-medium leading-tight">
                      {(o.supplier as any)?.name ?? 'Supplier'}
                    </p>
                    <p className="text-xs text-slate-500">{new Date(o.created_at).toLocaleDateString('en-ZA')}</p>
                  </div>
                  <div className="flex items-center gap-3">
                    {o.total_amount != null && (
                      <span className="text-sm text-slate-300 font-medium tabular-nums">
                        {formatZAR(o.total_amount)}
                      </span>
                    )}
                    <span className={`text-xs px-2 py-0.5 rounded-full font-medium capitalize ${orderStatusColor(o.status)}`}>
                      {o.status.replace('_', ' ')}
                    </span>
                  </div>
                </Link>
              </li>
            ))}
          </ul>
        )}
      </div>

      {/* Quick actions */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
        {[
          { href: '/projects/new', label: 'New Project', icon: '📁' },
          { href: '/snags/new', label: 'Log Snag', icon: '⚠️' },
          { href: '/diary', label: 'Site Diary', icon: '📓' },
          { href: '/marketplace', label: 'Marketplace', icon: '🛒' },
        ].map(({ href, label, icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-center gap-3 px-4 py-3 bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-500 transition-colors"
          >
            <span className="text-lg">{icon}</span>
            <span className="text-sm font-medium text-white">{label}</span>
          </Link>
        ))}
      </div>
    </div>
  )
}
