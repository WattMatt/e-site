import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'
import { PageHeader } from '@/components/layout/Header'
import { cocStatusBadge } from '@/components/ui/Badge'
import { Card, CardBody } from '@/components/ui/Card'
import { CocUploadButton } from './CocUploadButton'

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

  return (
    <div>
      <div className="mb-6">
        <Link href="/compliance" className="text-slate-400 hover:text-white text-sm">← Compliance</Link>
      </div>

      <PageHeader
        title={site.name}
        subtitle={`${site.address}${site.city ? `, ${site.city}` : ''}`}
        actions={
          <div className="flex items-center gap-3">
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
      <div className="grid grid-cols-3 gap-4 mb-8">
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
      </div>

      {/* Subsections */}
      <div className="space-y-3">
        {subs.sort((a, b) => a.sort_order - b.sort_order).map((sub: any) => {
          const uploads = sub.coc_uploads ?? []
          const latest = uploads[uploads.length - 1]
          return (
            <Card key={sub.id}>
              <CardBody>
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p className="font-medium text-white">{sub.name}</p>
                      {sub.sans_ref && <span className="text-xs text-slate-500">{sub.sans_ref}</span>}
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
                  <div className="flex items-center gap-3 ml-4">
                    {cocStatusBadge(sub.coc_status)}
                    <CocUploadButton subsectionId={sub.id} orgId={orgId} />
                  </div>
                </div>
              </CardBody>
            </Card>
          )
        })}
        {subs.length === 0 && (
          <p className="text-center text-slate-400 py-8">No subsections added to this site yet.</p>
        )}
      </div>
    </div>
  )
}
