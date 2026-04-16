import { redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'

export default async function PortalCompliancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login?next=/compliance')

  // Client users are linked via user_organisations to a contractor org
  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id, role, organisation:organisations(name)')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) {
    return (
      <div className="text-center py-20">
        <p className="text-slate-400">You are not linked to any organisation.</p>
      </div>
    )
  }

  const orgId = membership.organisation_id
  const sites = await complianceService.listSites(supabase as any, orgId).catch(() => [])

  // Compute portfolio totals
  const portfolioTotal = sites.reduce((acc: number, s: any) => acc + (s.subsections?.length ?? 0), 0)
  const portfolioApproved = sites.reduce((acc: number, s: any) =>
    acc + (s.subsections?.filter((sub: any) => sub.coc_status === 'approved').length ?? 0), 0)
  const portfolioScore = portfolioTotal > 0 ? Math.round((portfolioApproved / portfolioTotal) * 100) : null

  const scoreColor = (score: number | null) => {
    if (score === null) return 'text-slate-400'
    if (score >= 80) return 'text-green-400'
    if (score >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }

  const scoreBg = (score: number | null) => {
    if (score === null) return 'bg-slate-800 border-slate-700'
    if (score >= 80) return 'bg-green-950/40 border-green-800'
    if (score >= 50) return 'bg-yellow-950/40 border-yellow-800'
    return 'bg-red-950/40 border-red-800'
  }

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-white mb-1">Compliance Portfolio</h1>
        <p className="text-slate-400 text-sm">{(membership.organisation as any)?.name}</p>
      </div>

      {/* Portfolio score */}
      <div className={`rounded-2xl p-6 border mb-8 ${scoreBg(portfolioScore)}`}>
        <div className="flex items-center justify-between">
          <div>
            <p className="text-sm text-slate-400 mb-1">Portfolio Compliance Score</p>
            <p className={`text-5xl font-bold ${scoreColor(portfolioScore)}`}>
              {portfolioScore !== null ? `${portfolioScore}%` : '—'}
            </p>
            <p className="text-slate-500 text-sm mt-2">
              {portfolioApproved} of {portfolioTotal} subsections approved across {sites.length} site{sites.length !== 1 ? 's' : ''}
            </p>
          </div>
          <div className="text-right">
            <div className="flex flex-col gap-1.5 text-sm">
              {[
                { label: 'Approved', color: 'text-green-400', count: portfolioApproved },
                { label: 'Pending', color: 'text-blue-400', count: sites.reduce((a: number, s: any) => a + (s.subsections?.filter((x: any) => ['submitted','under_review'].includes(x.coc_status)).length ?? 0), 0) },
                { label: 'Missing', color: 'text-red-400', count: sites.reduce((a: number, s: any) => a + (s.subsections?.filter((x: any) => x.coc_status === 'missing').length ?? 0), 0) },
              ].map(({ label, color, count }) => (
                <div key={label} className="flex items-center gap-2 justify-end">
                  <span className={`font-semibold tabular-nums ${color}`}>{count}</span>
                  <span className="text-slate-400">{label}</span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Sites list */}
      {sites.length === 0 ? (
        <div className="text-center py-16">
          <p className="text-slate-400">No compliance sites found.</p>
        </div>
      ) : (
        <div className="space-y-3">
          {sites.map((site: any) => {
            const subs = site.subsections ?? []
            const approved = subs.filter((s: any) => s.coc_status === 'approved').length
            const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
            const missing = subs.filter((s: any) => s.coc_status === 'missing').length
            const score = subs.length > 0 ? Math.round((approved / subs.length) * 100) : null

            return (
              <Link
                key={site.id}
                href={`/compliance/${site.id}`}
                className="block bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-start justify-between gap-4">
                  <div className="flex-1 min-w-0">
                    <p className="font-semibold text-white">{site.name}</p>
                    <p className="text-sm text-slate-400 mt-0.5">{[site.address, site.city].filter(Boolean).join(', ')}</p>
                    <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                      <span className="text-green-400 font-medium">{approved} approved</span>
                      {pending > 0 && <span className="text-blue-400 font-medium">{pending} pending</span>}
                      {missing > 0 && <span className="text-red-400 font-medium">{missing} missing</span>}
                    </div>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-2xl font-bold ${scoreColor(score)}`}>
                      {score !== null ? `${score}%` : '—'}
                    </p>
                    <p className="text-xs text-slate-500">{subs.length} items</p>
                  </div>
                </div>

                {/* Progress bar */}
                {subs.length > 0 && (
                  <div className="mt-4 h-1.5 bg-slate-800 rounded-full overflow-hidden">
                    <div
                      className={`h-full rounded-full transition-all ${
                        score !== null && score >= 80 ? 'bg-green-500' :
                        score !== null && score >= 50 ? 'bg-yellow-500' : 'bg-red-500'
                      }`}
                      style={{ width: `${score ?? 0}%` }}
                    />
                  </div>
                )}
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
