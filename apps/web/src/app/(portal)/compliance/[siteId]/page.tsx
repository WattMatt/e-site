import { notFound, redirect } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'

interface Props {
  params: Promise<{ siteId: string }>
}

const STATUS_LABEL: Record<string, string> = {
  approved: 'Approved',
  submitted: 'Submitted',
  under_review: 'Under Review',
  rejected: 'Rejected',
  missing: 'Missing',
}

const STATUS_COLOR: Record<string, string> = {
  approved: 'bg-green-500/10 text-green-400 border-green-800',
  submitted: 'bg-blue-500/10 text-blue-400 border-blue-800',
  under_review: 'bg-indigo-500/10 text-indigo-400 border-indigo-800',
  rejected: 'bg-red-500/10 text-red-400 border-red-800',
  missing: 'bg-slate-700/50 text-slate-400 border-slate-600',
}

export default async function PortalSitePage({ params }: Props) {
  const { siteId } = await params

  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect(`/login?next=/compliance/${siteId}`)

  const site = await complianceService.getSite(supabase as any, siteId).catch(() => null)
  if (!site) notFound()

  const scoreData = await complianceService.getSiteComplianceScore(supabase as any, siteId).catch(() => null)

  const subsections: any[] = (site as any).subsections ?? []

  // Group subsections by status for summary
  const byCocStatus = subsections.reduce((acc: Record<string, number>, s) => {
    acc[s.coc_status] = (acc[s.coc_status] ?? 0) + 1
    return acc
  }, {})

  // Compliance trend: count uploads per month over last 6 months
  const allUploads = subsections.flatMap((s: any) => s.coc_uploads ?? [])
  const trendMap: Record<string, { total: number; approved: number }> = {}
  const now = new Date()
  for (let i = 5; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1)
    const key = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`
    trendMap[key] = { total: 0, approved: 0 }
  }
  for (const upload of allUploads) {
    const key = upload.created_at?.slice(0, 7)
    if (key && trendMap[key]) {
      trendMap[key].total++
      if (upload.status === 'approved') trendMap[key].approved++
    }
  }
  const trend = Object.entries(trendMap).map(([month, v]) => ({
    month,
    label: new Date(month + '-01').toLocaleDateString('en-ZA', { month: 'short' }),
    ...v,
  }))
  const maxTotal = Math.max(...trend.map(t => t.total), 1)

  const scoreColor = (s: number | null | undefined) => {
    if (!s && s !== 0) return 'text-slate-400'
    if (s >= 80) return 'text-green-400'
    if (s >= 50) return 'text-yellow-400'
    return 'text-red-400'
  }

  return (
    <div>
      <div className="mb-6">
        <Link href="/compliance" className="text-slate-400 hover:text-white text-sm">← All sites</Link>
      </div>

      <div className="flex items-start justify-between mb-8">
        <div>
          <h1 className="text-2xl font-bold text-white mb-1">{(site as any).name}</h1>
          <p className="text-slate-400 text-sm">
            {[(site as any).address, (site as any).city, (site as any).province].filter(Boolean).join(', ')}
          </p>
          {(site as any).erf_number && (
            <p className="text-slate-500 text-xs mt-1">ERF {(site as any).erf_number}</p>
          )}
        </div>
        <div className="text-right">
          <p className={`text-4xl font-bold ${scoreColor(scoreData?.score)}`}>
            {scoreData?.score !== undefined ? `${scoreData.score}%` : '—'}
          </p>
          <p className="text-xs text-slate-500 mt-0.5">Compliance score</p>
        </div>
      </div>

      {/* Score breakdown */}
      <div className="grid grid-cols-4 gap-3 mb-8">
        {[
          { label: 'Approved', count: scoreData?.approved ?? 0, color: 'text-green-400' },
          { label: 'Pending', count: (byCocStatus.submitted ?? 0) + (byCocStatus.under_review ?? 0), color: 'text-blue-400' },
          { label: 'Rejected', count: byCocStatus.rejected ?? 0, color: 'text-red-400' },
          { label: 'Missing', count: scoreData?.missing ?? 0, color: 'text-slate-400' },
        ].map(({ label, count, color }) => (
          <div key={label} className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
            <p className={`text-2xl font-bold ${color}`}>{count}</p>
            <p className="text-xs text-slate-400 mt-0.5">{label}</p>
          </div>
        ))}
      </div>

      {/* Compliance trend */}
      {allUploads.length > 0 && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 mb-8">
          <h2 className="text-sm font-semibold text-white mb-4">COC Activity — Last 6 Months</h2>
          <div className="flex items-end gap-2 h-20">
            {trend.map(t => (
              <div key={t.month} className="flex-1 flex flex-col items-center gap-1">
                <div className="w-full flex flex-col justify-end gap-0.5" style={{ height: 56 }}>
                  {t.total > 0 && (
                    <div
                      className="w-full bg-blue-500/30 rounded-sm relative overflow-hidden"
                      style={{ height: `${Math.round((t.total / maxTotal) * 56)}px` }}
                    >
                      {t.approved > 0 && (
                        <div
                          className="absolute bottom-0 left-0 right-0 bg-green-500/60"
                          style={{ height: `${Math.round((t.approved / t.total) * 100)}%` }}
                        />
                      )}
                    </div>
                  )}
                  {t.total === 0 && <div className="w-full h-0.5 bg-slate-800 rounded" />}
                </div>
                <span className="text-xs text-slate-500">{t.label}</span>
              </div>
            ))}
          </div>
          <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-blue-500/30 inline-block" /> Submitted</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-sm bg-green-500/60 inline-block" /> Approved</span>
          </div>
        </div>
      )}

      {/* Subsections list */}
      <h2 className="text-sm font-semibold text-white mb-3">Subsections ({subsections.length})</h2>
      {subsections.length === 0 ? (
        <p className="text-slate-500 text-sm py-4">No subsections defined for this site.</p>
      ) : (
        <div className="space-y-2">
          {subsections
            .sort((a, b) => a.sort_order - b.sort_order)
            .map((sub: any) => (
              <div
                key={sub.id}
                className="flex items-center justify-between bg-slate-900 border border-slate-800 rounded-lg px-4 py-3"
              >
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-white">{sub.name}</p>
                  {sub.sans_ref && <p className="text-xs text-slate-500 mt-0.5">{sub.sans_ref}</p>}
                </div>
                <span className={`text-xs px-2 py-0.5 rounded-full border font-medium flex-shrink-0 ml-4 ${STATUS_COLOR[sub.coc_status] ?? STATUS_COLOR.missing}`}>
                  {STATUS_LABEL[sub.coc_status] ?? sub.coc_status}
                </span>
              </div>
            ))}
        </div>
      )}
    </div>
  )
}
