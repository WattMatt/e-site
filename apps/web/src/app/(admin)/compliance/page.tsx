import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { cocStatusBadge } from '@/components/ui/Badge'
import Link from 'next/link'

export default async function CompliancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const sites = membership
    ? await complianceService.listSites(supabase as any, membership.organisation_id)
    : []

  // Compute score per site
  const sitesWithScore = sites.map((site) => {
    const subs = (site.subsections as any[]) ?? []
    const total = subs.length
    const approved = subs.filter((s) => s.coc_status === 'approved').length
    const score = total > 0 ? Math.round((approved / total) * 100) : 0
    return { ...site, score, total, approved }
  })

  return (
    <div>
      <PageHeader
        title="Compliance"
        subtitle="COC status across all sites"
        actions={
          <Link href="/compliance/new">
            <Button>+ New Site</Button>
          </Link>
        }
      />

      {sites.length === 0 ? (
        <EmptyState
          icon="✓"
          title="No sites yet"
          description="Add your first compliance site to start tracking COC status."
          action={<Link href="/compliance/new"><Button>Add Site</Button></Link>}
        />
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {sitesWithScore.map((site) => (
            <Link
              key={site.id}
              href={`/compliance/${site.id}`}
              className="block bg-slate-800 border border-slate-700 rounded-xl p-5 hover:border-slate-500 transition-colors"
            >
              <div className="flex items-start justify-between mb-3">
                <div>
                  <p className="font-semibold text-white">{site.name}</p>
                  <p className="text-xs text-slate-400 mt-0.5">{site.address}</p>
                </div>
                {/* Score ring */}
                <div className={`text-lg font-bold ${site.score === 100 ? 'text-emerald-400' : site.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
                  {site.score}%
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full bg-slate-700 rounded-full h-1.5 mb-3">
                <div
                  className={`h-1.5 rounded-full transition-all ${site.score === 100 ? 'bg-emerald-500' : site.score >= 50 ? 'bg-amber-500' : 'bg-red-500'}`}
                  style={{ width: `${site.score}%` }}
                />
              </div>

              {/* Sub-section status pills */}
              <div className="flex flex-wrap gap-1">
                {((site.subsections as any[]) ?? []).slice(0, 6).map((sub: any) => (
                  <span key={sub.id} title={sub.name}>{cocStatusBadge(sub.coc_status)}</span>
                ))}
                {((site.subsections as any[]) ?? []).length > 6 && (
                  <span className="text-xs text-slate-500">+{((site.subsections as any[]).length - 6)} more</span>
                )}
              </div>

              <p className="text-xs text-slate-500 mt-3">{site.approved}/{site.total} sections approved</p>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
