import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'
import { CopyLinkButton } from './CopyLinkButton'

interface Props { params: Promise<{ siteId: string }> }

const STATUS_STYLES: Record<string, { dot: string; label: string }> = {
  approved: { dot: 'bg-emerald-400', label: 'Approved' },
  submitted: { dot: 'bg-blue-400', label: 'Submitted' },
  under_review: { dot: 'bg-amber-400', label: 'Under Review' },
  rejected: { dot: 'bg-red-500', label: 'Rejected' },
  missing: { dot: 'bg-slate-600', label: 'Missing' },
}

export default async function PortalSiteDetailPage({ params }: Props) {
  const { siteId } = await params
  const supabase = await createClient()

  const site = await complianceService.getSite(supabase as any, siteId).catch(() => null)
  if (!site) notFound()

  const score = await complianceService.getSiteComplianceScore(supabase as any, siteId)
  const subs = (site.subsections as any[]) ?? []
  const siteUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/share/coc/${siteId}`

  return (
    <div>
      <div className="mb-6">
        <Link href="/portal/compliance" className="text-slate-400 hover:text-white text-sm">← All Sites</Link>
      </div>

      <div className="flex items-start justify-between mb-6 gap-4">
        <div>
          <h1 className="text-2xl font-bold text-white">{site.name}</h1>
          <p className="text-slate-400 text-sm mt-1">{(site as any).address}{(site as any).city ? `, ${(site as any).city}` : ''}</p>
        </div>
        <div className={`text-3xl font-bold flex-shrink-0 ${score.score === 100 ? 'text-emerald-400' : score.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
          {score.score}%
        </div>
      </div>

      {/* Score summary */}
      <div className="grid grid-cols-3 gap-3 mb-8">
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{score.approved}</p>
          <p className="text-xs text-slate-400 mt-1">Approved</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{score.pending}</p>
          <p className="text-xs text-slate-400 mt-1">Under Review</p>
        </div>
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{score.missing}</p>
          <p className="text-xs text-slate-400 mt-1">Missing</p>
        </div>
      </div>

      {/* Shareable link */}
      <div className="bg-slate-900 border border-slate-700 rounded-xl px-4 py-3 mb-6 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs text-slate-400 mb-1">Shareable link</p>
          <p className="text-xs text-slate-500 font-mono truncate">{siteUrl}</p>
        </div>
        <CopyLinkButton url={siteUrl} />
      </div>

      {/* Subsections */}
      <div className="space-y-2">
        {subs.sort((a: any, b: any) => a.sort_order - b.sort_order).map((sub: any) => {
          const style = STATUS_STYLES[sub.coc_status] ?? STATUS_STYLES.missing
          const uploads = sub.coc_uploads ?? []
          const latest = uploads[uploads.length - 1]
          return (
            <div key={sub.id} className="bg-slate-900 border border-slate-800 rounded-xl px-4 py-3">
              <div className="flex items-center justify-between gap-3">
                <div className="flex items-center gap-3 min-w-0">
                  <div className={`w-2.5 h-2.5 rounded-full flex-shrink-0 ${style.dot}`} />
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-white truncate">{sub.name}</p>
                    {sub.sans_ref && <p className="text-xs text-slate-500">{sub.sans_ref}</p>}
                    {latest && (
                      <p className="text-xs text-slate-500 mt-0.5">Updated {formatDate(latest.created_at)} · v{latest.version}</p>
                    )}
                  </div>
                </div>
                <span className={`text-xs font-medium flex-shrink-0 ${
                  sub.coc_status === 'approved' ? 'text-emerald-400' :
                  sub.coc_status === 'submitted' || sub.coc_status === 'under_review' ? 'text-amber-400' :
                  'text-red-400'
                }`}>{style.label}</span>
              </div>
            </div>
          )
        })}
      </div>
    </div>
  )
}
