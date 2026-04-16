import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { formatDate } from '@esite/shared'
import { cocStatusBadge } from '@/components/ui/Badge'
import { CocUploadButton } from '../CocUploadButton'
import { ReviewCocForm } from './ReviewCocForm'

interface Props {
  params: Promise<{ siteId: string; subsectionId: string }>
}

const STATUS_LABELS: Record<string, string> = {
  missing: 'Missing',
  submitted: 'Submitted',
  under_review: 'Under Review',
  approved: 'Approved',
  rejected: 'Rejected',
}

const STATUS_COLORS: Record<string, string> = {
  missing: 'text-slate-400',
  submitted: 'text-blue-400',
  under_review: 'text-amber-400',
  approved: 'text-emerald-400',
  rejected: 'text-red-400',
}

export default async function SubsectionPage({ params }: Props) {
  const { siteId, subsectionId } = await params
  const supabase = await createClient()

  // Load the subsection with all COC upload history
  const { data: subsection, error } = await supabase
    .schema('compliance')
    .from('subsections')
    .select(`
      id, name, description, sans_ref, coc_status, sort_order,
      site:sites!site_id(id, name, address, organisation_id),
      coc_uploads(
        id, status, file_path, version, review_notes, reviewed_at, created_at, file_size_bytes,
        uploaded_by_profile:profiles!uploaded_by(id, full_name, email),
        reviewer_profile:profiles!reviewer_id(id, full_name)
      )
    `)
    .eq('id', subsectionId)
    .eq('site_id', siteId)
    .order('version', { referencedTable: 'coc_uploads', ascending: false })
    .single()

  if (error || !subsection) notFound()

  const site = subsection.site as { id: string; name: string; address: string; organisation_id: string }
  const uploads = (subsection.coc_uploads as any[]).sort((a, b) => b.version - a.version)
  const latestUpload = uploads[0] ?? null

  // Check if current user has PM/admin role (for review controls)
  const { data: { user } } = await supabase.auth.getUser()
  const { data: membership } = user
    ? await supabase
        .from('user_organisations')
        .select('role')
        .eq('user_id', user.id)
        .eq('organisation_id', site.organisation_id)
        .eq('is_active', true)
        .maybeSingle()
    : { data: null }

  const canReview = ['owner', 'admin', 'project_manager'].includes(membership?.role ?? '')

  // Determine if latest upload is reviewable
  const latestIsReviewable =
    latestUpload &&
    (latestUpload.status === 'submitted' || latestUpload.status === 'under_review')

  return (
    <div className="max-w-2xl">
      {/* Breadcrumbs */}
      <div className="flex items-center gap-2 text-sm text-slate-400 mb-6">
        <Link href="/compliance" className="hover:text-white">Compliance</Link>
        <span>/</span>
        <Link href={`/compliance/${siteId}`} className="hover:text-white">{site.name}</Link>
        <span>/</span>
        <span className="text-slate-200">{subsection.name}</span>
      </div>

      {/* Header */}
      <div className="flex items-start justify-between mb-6">
        <div>
          <h1 className="text-xl font-semibold text-white">{subsection.name}</h1>
          {subsection.sans_ref && (
            <p className="text-sm text-slate-400 mt-0.5">{subsection.sans_ref}</p>
          )}
          {subsection.description && (
            <p className="text-sm text-slate-400 mt-1">{subsection.description}</p>
          )}
        </div>
        <div className="flex items-center gap-3">
          {cocStatusBadge(subsection.coc_status)}
          <CocUploadButton subsectionId={subsectionId} orgId={site.organisation_id} />
        </div>
      </div>

      {/* Current status */}
      <div className={`text-sm font-medium mb-8 ${STATUS_COLORS[subsection.coc_status ?? 'missing']}`}>
        Status: {STATUS_LABELS[subsection.coc_status ?? 'missing']}
      </div>

      {/* Review section — only shown to PM/admin when latest is reviewable */}
      {canReview && latestUpload && latestIsReviewable && (
        <div className="bg-slate-800 border border-amber-800/50 rounded-xl p-5 mb-6">
          <p className="text-sm font-semibold text-amber-400 mb-1">Review required</p>
          <p className="text-xs text-slate-400 mb-4">
            v{latestUpload.version} uploaded {formatDate(latestUpload.created_at)} by{' '}
            {latestUpload.uploaded_by_profile?.full_name ?? 'unknown'}
          </p>

          {/* COC document link */}
          {latestUpload.file_path && (
            <a
              href={`/api/compliance/document?path=${encodeURIComponent(latestUpload.file_path)}`}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-2 text-sm text-blue-400 hover:text-blue-300 mb-4"
            >
              View document ↗
            </a>
          )}

          <ReviewCocForm
            uploadId={latestUpload.id}
            subsectionId={subsectionId}
            siteId={siteId}
            currentStatus={latestUpload.status}
          />
        </div>
      )}

      {/* Upload history */}
      <div>
        <h2 className="text-sm font-semibold text-slate-300 mb-3">
          Upload history ({uploads.length})
        </h2>

        {uploads.length === 0 && (
          <div className="bg-slate-800 border border-dashed border-slate-600 rounded-xl p-8 text-center">
            <p className="text-slate-400 text-sm">No COC uploaded yet for this subsection.</p>
            <p className="text-slate-500 text-xs mt-1">
              Use the &quot;Upload COC&quot; button above to submit a certificate.
            </p>
          </div>
        )}

        <div className="space-y-3">
          {uploads.map((upload: any, idx: number) => {
            const isLatest = idx === 0
            const sizeMB = upload.file_size_bytes
              ? `${(upload.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
              : null

            return (
              <div
                key={upload.id}
                className={`bg-slate-800 border rounded-xl p-4 ${
                  isLatest ? 'border-slate-600' : 'border-slate-700 opacity-70'
                }`}
              >
                <div className="flex items-start justify-between">
                  <div>
                    <div className="flex items-center gap-2">
                      <span className="text-sm font-medium text-white">
                        Version {upload.version}
                      </span>
                      {isLatest && (
                        <span className="text-xs bg-slate-700 text-slate-300 px-1.5 py-0.5 rounded">
                          Latest
                        </span>
                      )}
                      {cocStatusBadge(upload.status)}
                    </div>

                    <p className="text-xs text-slate-400 mt-1">
                      Uploaded {formatDate(upload.created_at)} by{' '}
                      {upload.uploaded_by_profile?.full_name ?? 'unknown'}
                      {sizeMB && ` · ${sizeMB}`}
                    </p>

                    {upload.review_notes && (
                      <p className="text-xs text-slate-400 mt-1.5 italic">
                        Review note: {upload.review_notes}
                      </p>
                    )}

                    {upload.reviewed_at && upload.reviewer_profile && (
                      <p className="text-xs text-slate-500 mt-0.5">
                        Reviewed {formatDate(upload.reviewed_at)} by{' '}
                        {upload.reviewer_profile.full_name}
                      </p>
                    )}
                  </div>

                  {upload.file_path && (
                    <a
                      href={`/api/compliance/document?path=${encodeURIComponent(upload.file_path)}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-blue-400 hover:text-blue-300 ml-4 whitespace-nowrap"
                    >
                      View ↗
                    </a>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
