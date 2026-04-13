import { createClient } from '@/lib/supabase/server'
import { projectService } from '@esite/shared'
import { KpiCard } from '@/components/ui/Card'
import { PageHeader } from '@/components/layout/Header'
import Link from 'next/link'

export default async function DashboardPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  // Get user's primary org
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role, organisation:organisations(name)')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const orgId = membership?.organisation_id

  const stats = orgId
    ? await projectService.getStats(supabase as any, orgId)
    : { activeProjects: 0, openSnags: 0, pendingCocs: 0 }

  return (
    <div>
      <PageHeader
        title="Dashboard"
        subtitle={(membership?.organisation as any)?.name ?? 'E-Site'}
      />

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6 mb-10">
        <KpiCard label="Active Projects" value={stats.activeProjects} />
        <KpiCard
          label="Open Snags"
          value={stats.openSnags}
          variant={stats.openSnags > 0 ? 'danger' : 'default'}
        />
        <KpiCard
          label="Pending COCs"
          value={stats.pendingCocs}
          variant={stats.pendingCocs > 0 ? 'warning' : 'default'}
        />
      </div>

      {/* Quick links */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {[
          { href: '/projects/new', label: 'New Project', desc: 'Start a new construction project', icon: '➕' },
          { href: '/snags', label: 'View Snags', desc: 'Track and resolve field issues', icon: '⚠' },
          { href: '/compliance', label: 'Compliance', desc: 'COC status across all sites', icon: '✓' },
          { href: '/rfis', label: 'RFIs', desc: 'Manage requests for information', icon: '❓' },
        ].map(({ href, label, desc, icon }) => (
          <Link
            key={href}
            href={href}
            className="flex items-start gap-4 p-5 bg-slate-800 rounded-xl border border-slate-700 hover:border-slate-500 transition-colors"
          >
            <span className="text-2xl">{icon}</span>
            <div>
              <p className="font-semibold text-white">{label}</p>
              <p className="text-slate-400 text-sm">{desc}</p>
            </div>
          </Link>
        ))}
      </div>
    </div>
  )
}
