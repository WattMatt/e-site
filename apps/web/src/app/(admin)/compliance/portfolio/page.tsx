/**
 * T-028: Consulting engineer portfolio view
 *
 * Read-only compliance health aggregated across all linked projects/sites.
 * Intended for consulting engineers who oversee multiple contractors' compliance.
 *
 * Accessible at: /compliance/portfolio
 * Role: owner, admin, inspector — read-only
 *
 * Features:
 * - Portfolio-wide compliance score (weighted average)
 * - Per-site health cards with traffic-light indicators
 * - COC status breakdown table across all sites
 * - Exportable compliance pack (PDF link to generate-report edge function)
 */

import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'
import { Button } from '@/components/ui/Button'

// ─── Helpers ─────────────────────────────────────────────────────────────────

function scoreColor(score: number) {
  if (score >= 80) return { text: 'text-emerald-400', bg: 'bg-emerald-500', border: 'border-emerald-700' }
  if (score >= 50) return { text: 'text-amber-400', bg: 'bg-amber-500', border: 'border-amber-700' }
  return { text: 'text-red-400', bg: 'bg-red-500', border: 'border-red-700' }
}

function trafficLight(score: number) {
  if (score >= 80) return { label: 'Compliant', dot: 'bg-emerald-500' }
  if (score >= 50) return { label: 'At Risk', dot: 'bg-amber-500' }
  return { label: 'Non-Compliant', dot: 'bg-red-500' }
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default async function CompliancePortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) redirect('/login')

  const orgId = membership.organisation_id

  // Fetch all sites with their subsections (full hierarchy for scoring)
  const { data: sitesRaw } = await supabase
    .schema('compliance')
    .from('sites')
    .select(`
      id, name, address, city, province, status, created_at,
      subsections (
        id, name, coc_status, sans_ref, sort_order,
        coc_uploads (
          id, status, created_at, reviewed_at
        )
      )
    `)
    .eq('organisation_id', orgId)
    .order('name', { ascending: true })

  const sites = sitesRaw ?? []

  // Compute per-site metrics
  const sitesWithMetrics = sites.map((site: any) => {
    const subs: any[] = site.subsections ?? []
    const total = subs.length
    const approved = subs.filter((s: any) => s.coc_status === 'approved').length
    const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
    const missing = subs.filter((s: any) => ['missing', 'rejected'].includes(s.coc_status)).length
    const score = total > 0 ? Math.round((approved / total) * 100) : 0

    // Most recent COC activity
    const allUploads = subs.flatMap((s: any) => s.coc_uploads ?? [])
    allUploads.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const lastActivity = allUploads[0]?.created_at ?? null

    return { ...site, total, approved, pending, missing, score, lastActivity }
  })

  // Portfolio-wide aggregates
  const totalSubs = sitesWithMetrics.reduce((s, x) => s + x.total, 0)
  const totalApproved = sitesWithMetrics.reduce((s, x) => s + x.approved, 0)
  const totalPending = sitesWithMetrics.reduce((s, x) => s + x.pending, 0)
  const totalMissing = sitesWithMetrics.reduce((s, x) => s + x.missing, 0)
  const portfolioScore = totalSubs > 0 ? Math.round((totalApproved / totalSubs) * 100) : 0

  const compliantSites = sitesWithMetrics.filter(s => s.score >= 80).length
  const atRiskSites = sitesWithMetrics.filter(s => s.score >= 50 && s.score < 80).length
  const nonCompliantSites = sitesWithMetrics.filter(s => s.score < 50).length

  const portfolioColors = scoreColor(portfolioScore)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  return (
    <div className="space-y-8">
      {/* ── Header ─────────────────────────────────────────────────────── */}
      <div className="flex items-start justify-between">
        <div>
          <h1 className="text-2xl font-bold text-white">Compliance Portfolio</h1>
          <p className="text-slate-400 mt-1">Portfolio-wide COC health across {sites.length} site{sites.length !== 1 ? 's' : ''}</p>
        </div>
        <div className="flex gap-3">
          <Link href="/compliance">
            <Button variant="ghost">← Sites</Button>
          </Link>
          <a
            href={`${supabaseUrl}/functions/v1/generate-report?orgId=${orgId}&type=compliance_portfolio`}
            target="_blank"
            rel="noopener noreferrer"
          >
            <Button variant="secondary">Export PDF</Button>
          </a>
        </div>
      </div>

      {/* ── Portfolio score + summary ───────────────────────────────────── */}
      <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
        {/* Big score */}
        <div className={`bg-slate-800 border rounded-xl p-6 flex flex-col items-center justify-center md:col-span-1 ${portfolioColors.border}`}>
          <p className="text-xs text-slate-400 font-medium uppercase tracking-wider mb-2">Portfolio Score</p>
          <p className={`text-6xl font-black ${portfolioColors.text}`}>{portfolioScore}%</p>
          <p className="text-xs text-slate-500 mt-2">{totalApproved} / {totalSubs} subsections approved</p>
        </div>

        {/* COC status breakdown */}
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col justify-center">
          <p className="text-2xl font-bold text-emerald-400">{totalApproved}</p>
          <p className="text-sm text-slate-300 font-medium mt-1">Approved COCs</p>
          <div className="w-full bg-slate-700 rounded-full h-1 mt-3">
            <div className="h-1 rounded-full bg-emerald-500" style={{ width: totalSubs > 0 ? `${(totalApproved / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col justify-center">
          <p className="text-2xl font-bold text-amber-400">{totalPending}</p>
          <p className="text-sm text-slate-300 font-medium mt-1">Pending Review</p>
          <div className="w-full bg-slate-700 rounded-full h-1 mt-3">
            <div className="h-1 rounded-full bg-amber-500" style={{ width: totalSubs > 0 ? `${(totalPending / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>

        <div className="bg-slate-800 border border-slate-700 rounded-xl p-5 flex flex-col justify-center">
          <p className="text-2xl font-bold text-red-400">{totalMissing}</p>
          <p className="text-sm text-slate-300 font-medium mt-1">Missing / Rejected</p>
          <div className="w-full bg-slate-700 rounded-full h-1 mt-3">
            <div className="h-1 rounded-full bg-red-500" style={{ width: totalSubs > 0 ? `${(totalMissing / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>
      </div>

      {/* ── Site health band ───────────────────────────────────────────── */}
      <div className="flex gap-4 text-sm">
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
          <span className="text-slate-300">{compliantSites} Compliant</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-amber-500" />
          <span className="text-slate-300">{atRiskSites} At Risk</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-2.5 h-2.5 rounded-full bg-red-500" />
          <span className="text-slate-300">{nonCompliantSites} Non-Compliant</span>
        </div>
      </div>

      {/* ── Per-site table ─────────────────────────────────────────────── */}
      {sites.length === 0 ? (
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-12 text-center">
          <p className="text-slate-400">No compliance sites found for this organisation.</p>
          <Link href="/compliance/new" className="mt-4 inline-block">
            <Button>Add First Site</Button>
          </Link>
        </div>
      ) : (
        <div className="bg-slate-800 border border-slate-700 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 flex items-center justify-between">
            <h2 className="font-semibold text-white">Site-by-Site Breakdown</h2>
            <p className="text-xs text-slate-500">{sites.length} sites</p>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-slate-700 text-left">
                  <th className="px-5 py-3 text-slate-400 font-medium">Site</th>
                  <th className="px-5 py-3 text-slate-400 font-medium">Status</th>
                  <th className="px-5 py-3 text-slate-400 font-medium text-right">Score</th>
                  <th className="px-5 py-3 text-slate-400 font-medium text-right">Approved</th>
                  <th className="px-5 py-3 text-slate-400 font-medium text-right">Pending</th>
                  <th className="px-5 py-3 text-slate-400 font-medium text-right">Missing</th>
                  <th className="px-5 py-3 text-slate-400 font-medium text-right">Total</th>
                  <th className="px-5 py-3 text-slate-400 font-medium">Progress</th>
                </tr>
              </thead>
              <tbody>
                {sitesWithMetrics.map((site) => {
                  const tl = trafficLight(site.score)
                  const sc = scoreColor(site.score)
                  return (
                    <tr key={site.id} className="border-b border-slate-700/50 hover:bg-slate-700/20">
                      <td className="px-5 py-3">
                        <Link href={`/compliance/${site.id}`} className="text-white hover:text-blue-400 font-medium">
                          {site.name}
                        </Link>
                        {(site.city || site.province) && (
                          <p className="text-xs text-slate-500 mt-0.5">
                            {[site.city, site.province].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </td>
                      <td className="px-5 py-3">
                        <span className="flex items-center gap-1.5">
                          <span className={`w-2 h-2 rounded-full ${tl.dot}`} />
                          <span className="text-slate-300 text-xs">{tl.label}</span>
                        </span>
                      </td>
                      <td className={`px-5 py-3 text-right font-bold ${sc.text}`}>{site.score}%</td>
                      <td className="px-5 py-3 text-right text-emerald-400">{site.approved}</td>
                      <td className="px-5 py-3 text-right text-amber-400">{site.pending}</td>
                      <td className="px-5 py-3 text-right text-red-400">{site.missing}</td>
                      <td className="px-5 py-3 text-right text-slate-400">{site.total}</td>
                      <td className="px-5 py-3 w-32">
                        <div className="w-full bg-slate-700 rounded-full h-1.5">
                          <div className={`h-1.5 rounded-full ${sc.bg}`} style={{ width: `${site.score}%` }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              {/* Portfolio totals row */}
              <tfoot>
                <tr className="border-t border-slate-600 bg-slate-700/30">
                  <td className="px-5 py-3 font-semibold text-slate-200" colSpan={2}>Portfolio Total</td>
                  <td className={`px-5 py-3 text-right font-bold ${portfolioColors.text}`}>{portfolioScore}%</td>
                  <td className="px-5 py-3 text-right font-semibold text-emerald-400">{totalApproved}</td>
                  <td className="px-5 py-3 text-right font-semibold text-amber-400">{totalPending}</td>
                  <td className="px-5 py-3 text-right font-semibold text-red-400">{totalMissing}</td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-300">{totalSubs}</td>
                  <td className="px-5 py-3 w-32">
                    <div className="w-full bg-slate-700 rounded-full h-1.5">
                      <div className={`h-1.5 rounded-full ${portfolioColors.bg}`} style={{ width: `${portfolioScore}%` }} />
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* ── Subsection detail (expandable COC list) ────────────────────── */}
      {sitesWithMetrics.some(s => s.missing > 0 || s.pending > 0) && (
        <div className="bg-slate-800 border border-amber-800/50 rounded-xl overflow-hidden">
          <div className="px-5 py-4 border-b border-slate-700 bg-amber-900/20">
            <h2 className="font-semibold text-amber-300">Outstanding COCs requiring attention</h2>
            <p className="text-xs text-amber-400/70 mt-0.5">Subsections with missing or rejected COC uploads</p>
          </div>
          <div className="divide-y divide-slate-700/50">
            {sitesWithMetrics
              .filter(s => s.missing > 0 || s.pending > 0)
              .flatMap(site =>
                (site.subsections as any[])
                  .filter((sub: any) => ['missing', 'rejected'].includes(sub.coc_status))
                  .map((sub: any) => ({ site, sub }))
              )
              .map(({ site, sub }) => (
                <div key={sub.id} className="px-5 py-3 flex items-center justify-between">
                  <div>
                    <p className="text-sm text-white">{sub.name}</p>
                    <p className="text-xs text-slate-500">
                      {site.name}{sub.sans_ref ? ` · SANS ${sub.sans_ref}` : ''}
                    </p>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      sub.coc_status === 'rejected'
                        ? 'bg-red-900/40 text-red-300'
                        : 'bg-slate-700 text-slate-400'
                    }`}>
                      {sub.coc_status === 'rejected' ? 'Rejected' : 'Missing'}
                    </span>
                    <Link
                      href={`/compliance/${site.id}#${sub.id}`}
                      className="text-xs text-blue-400 hover:text-blue-300"
                    >
                      View →
                    </Link>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
