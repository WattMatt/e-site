import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'
import Link from 'next/link'

function ScoreRing({ score }: { score: number }) {
  const color = score === 100 ? '#10B981' : score >= 50 ? '#F59E0B' : '#EF4444'
  return (
    <div
      className="w-14 h-14 rounded-full flex items-center justify-center text-sm font-bold flex-shrink-0"
      style={{ border: `3px solid ${color}`, color }}
    >
      {score}%
    </div>
  )
}

export default async function PortalCompliancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: mem } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const sites = mem
    ? await complianceService.listSites(supabase as any, mem.organisation_id).catch(() => [])
    : []

  return (
    <div>
      <h1 className="text-2xl font-bold text-white mb-2">Compliance Status</h1>
      <p className="text-slate-400 text-sm mb-8">Read-only view of your project COC compliance.</p>

      {sites.length === 0 ? (
        <div className="text-center py-20">
          <div className="text-5xl mb-4">📋</div>
          <p className="text-white font-semibold">No sites found</p>
          <p className="text-slate-400 text-sm mt-2">Your contractor will share compliance status here.</p>
        </div>
      ) : (
        <div className="space-y-4">
          {sites.map((site: any) => {
            const subs = site.subsections ?? []
            const total = subs.length
            const approved = subs.filter((s: any) => s.coc_status === 'approved').length
            const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
            const missing = total - approved - pending
            const score = total === 0 ? 0 : Math.round((approved / total) * 100)

            return (
              <Link
                key={site.id}
                href={`/portal/compliance/${site.id}`}
                className="block bg-slate-900 border border-slate-800 hover:border-slate-600 rounded-xl p-5 transition-colors"
              >
                <div className="flex items-start gap-4">
                  <ScoreRing score={score} />
                  <div className="flex-1">
                    <p className="font-semibold text-white text-base">{site.name}</p>
                    <p className="text-sm text-slate-400 mt-0.5">{site.address}{site.city ? `, ${site.city}` : ''}</p>
                    <div className="flex gap-4 mt-3 text-xs">
                      <span className="text-emerald-400">{approved} approved</span>
                      <span className="text-amber-400">{pending} pending</span>
                      <span className="text-red-400">{missing} missing</span>
                      <span className="text-slate-500">{total} total</span>
                    </div>
                  </div>
                  <span className="text-slate-600 text-lg">›</span>
                </div>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
