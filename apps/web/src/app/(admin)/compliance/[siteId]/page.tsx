import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { cocStatusBadge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { CocUploadButton } from './CocUploadButton'
import { AddSubsectionForm } from './AddSubsectionForm'
import { ReportButton } from '@/components/ui/ReportButton'

interface Props {
  params: Promise<{ siteId: string }>
}

export default async function SiteDetailPage({ params }: Props) {
  const { siteId } = await params
  const supabase = await createClient()

  const site = await complianceService.getSite(supabase as any, siteId).catch(() => null)
  if (!site) notFound()

  const subs = (site.subsections as any[]) ?? []
  const score = await complianceService.getSiteComplianceScore(supabase as any, siteId)
  const orgId = (site as any).organisation_id as string

  // Determine if current user has PM/admin role for this org
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = user
    ? await supabase
        .from('user_organisations')
        .select('role')
        .eq('user_id', user.id)
        .eq('organisation_id', orgId)
        .eq('is_active', true)
        .maybeSingle()
    : { data: null }
  const canManage = ['owner', 'admin', 'project_manager'].includes(membership?.role ?? '')

  // Count subsections needing review
  const pendingReview = subs.filter(
    (s: any) => s.coc_status === 'submitted' || s.coc_status === 'under_review'
  ).length

  return (
    <div>
      <div className="mb-6">
        <Link href="/compliance" className="text-slate-400 hover:text-white text-sm">← Compliance</Link>
      </div>

      <PageHeader
        title={site.name}
        subtitle={`${(site as any).address}${(site as any).city ? `, ${(site as any).city}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
            <Link
              href={`/compliance/${siteId}/certificate-pack`}
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              ↓ Certificate Pack
            </Link>
            <ReportButton type="compliance" entityId={siteId} label="↓ COC Report" />
            <a
              href={`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/share/coc/${siteId}`}
              target="_blank"
              rel="noopener noreferrer"
              className="text-sm px-3 py-1.5 bg-slate-700 hover:bg-slate-600 text-slate-300 rounded-lg transition-colors"
            >
              Share ↗
            </a>
            <div className={`text-2xl font-bold ${score.score === 100 ? 'text-emerald-400' : score.score >= 50 ? 'text-amber-400' : 'text-red-400'}`}>
              {score.score}% compliant
            </div>
          </div>
        }
      />

      {/* Score breakdown */}
      <div className="grid grid-cols-4 gap-4 mb-8">
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-emerald-400">{score.approved}</p>
          <p className="text-xs text-slate-400 mt-1">Approved</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-amber-400">{score.pending}</p>
          <p className="text-xs text-slate-400 mt-1">Under Review</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-red-400">{score.missing}</p>
          <p className="text-xs text-slate-400 mt-1">Missing</p>
        </div>
        <div className="bg-slate-800 border border-slate-700 rounded-xl p-4 text-center">
          <p className="text-2xl font-bold text-slate-200">{score.total}</p>
          <p className="text-xs text-slate-400 mt-1">Total</p>
        </div>
      </div>

      {/* Pending review banner */}
      {canManage && pendingReview > 0 && (
        <div className="bg-amber-900/20 border border-amber-700/40 rounded-xl px-4 py-3 mb-6 text-sm text-amber-400">
          {pendingReview} subsection{pendingReview > 1 ? 's' : ''} awaiting review — click a subsection to approve or reject.
        </div>
      )}

      {/* Subsections */}
      <div className="space-y-3">
        <div className="flex items-center justify-between mb-1">
          <h2 className="text-sm font-semibold text-slate-300">Subsections ({subs.length})</h2>
          {canManage && <AddSubsectionForm siteId={siteId} />}
        </div>

        {subs.sort((a: any, b: any) => a.sort_order - b.sort_order).map((sub: any) => {
          const uploads = (sub.coc_uploads ?? []) as any[]
          const latest = uploads.sort((a: any, b: any) => b.version - a.version)[0]
          const needsReview = sub.coc_status === 'submitted' || sub.coc_status === 'under_review'
          return (
            <Link
              key={sub.id}
              href={`/compliance/${siteId}/${sub.id}`}
              className="block"
            >
              <Card className={`hover:border-slate-500 transition-colors cursor-pointer ${needsReview && canManage ? 'border-amber-700/40' : ''}`}>
                <CardBody>
                  <div className="flex items-start justify-between">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-medium text-white">{sub.name}</p>
                        {sub.sans_ref && <span className="text-xs text-slate-500">{sub.sans_ref}</span>}
                        {needsReview && canManage && (
                          <span className="text-xs bg-amber-900/40 text-amber-400 px-1.5 py-0.5 rounded">Review needed</span>
                        )}
                      </div>
                      {sub.description && <p className="text-xs text-slate-400 mt-0.5">{sub.description}</p>}
                      {latest && (
                        <p className="text-xs text-slate-500 mt-2">
                          Last upload: {formatDate(latest.created_at)} by {latest.uploaded_by_profile?.full_name ?? 'unknown'} · v{latest.version}
                        </p>
                      )}
                      {uploads.length === 0 && (
                        <p className="text-xs text-slate-500 mt-2">No COC uploaded yet</p>
                      )}
                    </div>
                    <div className="flex items-center gap-3 ml-4" onClick={(e) => e.preventDefault()}>
                      {cocStatusBadge(sub.coc_status)}
                      <CocUploadButton subsectionId={sub.id} orgId={orgId} />
                    </div>
                  </div>
                </CardBody>
              </Card>
            </Link>
          )
        })}
        {subs.length === 0 && (
          <div className="text-center py-12 bg-slate-800/50 border border-dashed border-slate-700 rounded-xl">
            <p className="text-slate-400">No subsections yet.</p>
            {canManage && (
              <p className="text-slate-500 text-sm mt-1">Use &quot;Add subsection&quot; above to get started.</p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
