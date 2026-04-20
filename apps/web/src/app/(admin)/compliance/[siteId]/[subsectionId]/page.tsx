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
  missing: 'var(--c-text-dim)',
  submitted: '#60a5fa',
  under_review: 'var(--c-amber)',
  approved: '#4ade80',
  rejected: 'var(--c-red)',
}

export default async function SubsectionPage({ params }: Props) {
  const { siteId, subsectionId } = await params
  const supabase = await createClient()

  const { data: rawSub, error } = await supabase
    .schema('compliance')
    .from('subsections')
    .select(`
      id, name, description, sans_ref, coc_status, sort_order,
      site:sites!site_id(id, name, address, organisation_id),
      coc_uploads(
        id, status, file_path, version, review_notes, reviewed_at, created_at, file_size_bytes,
        uploaded_by, reviewer_id
      )
    `)
    .eq('id', subsectionId)
    .eq('site_id', siteId)
    .order('version', { referencedTable: 'coc_uploads', ascending: false })
    .single()

  if (error || !rawSub) notFound()

  const rawUploads = (rawSub.coc_uploads as any[]) ?? []
  const profileIds = [...new Set([
    ...rawUploads.map((u: any) => u.uploaded_by),
    ...rawUploads.map((u: any) => u.reviewer_id),
  ].filter(Boolean))]
  const { data: profileRows } = profileIds.length
    ? await supabase.from('profiles').select('id, full_name, email').in('id', profileIds)
    : { data: [] }
  const profileMap = Object.fromEntries((profileRows ?? []).map((p: any) => [p.id, p]))

  const subsection = {
    ...rawSub,
    coc_uploads: rawUploads.map((u: any) => ({
      ...u,
      uploaded_by_profile: u.uploaded_by ? (profileMap[u.uploaded_by] ?? null) : null,
      reviewer_profile: u.reviewer_id ? (profileMap[u.reviewer_id] ?? null) : null,
    })),
  }

  const site = subsection.site as { id: string; name: string; address: string; organisation_id: string }
  const uploads = (subsection.coc_uploads as any[]).sort((a, b) => b.version - a.version)
  const latestUpload = uploads[0] ?? null

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

  const latestIsReviewable =
    latestUpload &&
    (latestUpload.status === 'submitted' || latestUpload.status === 'under_review')

  const statusColor = STATUS_COLORS[subsection.coc_status ?? 'missing']

  return (
    <div className="animate-fadeup" style={{ maxWidth: 720 }}>
      {/* Breadcrumbs */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16, fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
        <Link href="/compliance" style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>Compliance</Link>
        <span>/</span>
        <Link href={`/compliance/${siteId}`} style={{ color: 'var(--c-text-dim)', textDecoration: 'none' }}>{site.name}</Link>
        <span>/</span>
        <span style={{ color: 'var(--c-text-mid)' }}>{subsection.name}</span>
      </div>

      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">{subsection.name}</h1>
          {subsection.sans_ref && (
            <p className="page-subtitle">{subsection.sans_ref}</p>
          )}
          {subsection.description && (
            <p style={{ fontSize: 13, color: 'var(--c-text-dim)', marginTop: 4 }}>{subsection.description}</p>
          )}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          {cocStatusBadge(subsection.coc_status)}
          <CocUploadButton subsectionId={subsectionId} orgId={site.organisation_id} />
        </div>
      </div>

      <div
        style={{
          fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
          letterSpacing: '0.08em', textTransform: 'uppercase',
          color: statusColor, marginBottom: 20,
        }}
      >
        Status: {STATUS_LABELS[subsection.coc_status ?? 'missing']}
      </div>

      {canReview && latestUpload && latestIsReviewable && (
        <div
          className="data-panel"
          style={{ borderColor: 'var(--c-amber-mid)', marginBottom: 18 }}
        >
          <div style={{ padding: '16px 18px' }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-amber)', marginBottom: 4 }}>
              Review required
            </p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginBottom: 14, letterSpacing: '0.04em' }}>
              v{latestUpload.version} uploaded {formatDate(latestUpload.created_at)} by{' '}
              {latestUpload.uploaded_by_profile?.full_name ?? 'unknown'}
            </p>

            {latestUpload.file_path && (
              <a
                href={`/api/compliance/document?path=${encodeURIComponent(latestUpload.file_path)}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-block', marginBottom: 14,
                  fontFamily: 'var(--font-mono)', fontSize: 11,
                  color: 'var(--c-amber)', textDecoration: 'none',
                  letterSpacing: '0.04em',
                }}
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
        </div>
      )}

      <div>
        <h2 style={{ fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', margin: '0 0 10px' }}>
          Upload history ({uploads.length})
        </h2>

        {uploads.length === 0 && (
          <div className="data-panel">
            <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
              No COC uploaded yet for this subsection.
              <div style={{ marginTop: 6, fontSize: 11 }}>
                Use the &quot;Upload COC&quot; button above to submit a certificate.
              </div>
            </div>
          </div>
        )}

        <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          {uploads.map((upload: any, idx: number) => {
            const isLatest = idx === 0
            const sizeMB = upload.file_size_bytes
              ? `${(upload.file_size_bytes / 1024 / 1024).toFixed(1)} MB`
              : null

            return (
              <div
                key={upload.id}
                className="data-panel"
                style={isLatest ? undefined : { opacity: 0.7 }}
              >
                <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                  <div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)' }}>
                        Version {upload.version}
                      </span>
                      {isLatest && (
                        <span className="badge badge-muted">Latest</span>
                      )}
                      {cocStatusBadge(upload.status)}
                    </div>

                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 6, letterSpacing: '0.04em' }}>
                      Uploaded {formatDate(upload.created_at)} by{' '}
                      {upload.uploaded_by_profile?.full_name ?? 'unknown'}
                      {sizeMB && ` · ${sizeMB}`}
                    </p>

                    {upload.review_notes && (
                      <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginTop: 8, fontStyle: 'italic' }}>
                        Review note: {upload.review_notes}
                      </p>
                    )}

                    {upload.reviewed_at && upload.reviewer_profile && (
                      <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.04em' }}>
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
                      style={{
                        fontFamily: 'var(--font-mono)', fontSize: 10,
                        color: 'var(--c-amber)', textDecoration: 'none',
                        letterSpacing: '0.06em', whiteSpace: 'nowrap',
                        padding: '4px 8px', borderRadius: 4,
                        border: '1px solid var(--c-border)', background: 'var(--c-panel)',
                      }}
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
