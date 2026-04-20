import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'
import { cocStatusBadge } from '@/components/ui/Badge'
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

  const pendingReview = subs.filter(
    (s: any) => s.coc_status === 'submitted' || s.coc_status === 'under_review'
  ).length

  const scoreColor =
    score.score === 100 ? '#4ade80' :
    score.score >= 50 ? 'var(--c-amber)' :
    'var(--c-red)'

  const siteAddress = `${(site as any).address}${(site as any).city ? `, ${(site as any).city}` : ''}`

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/compliance"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← Compliance
        </Link>
      </div>

      <div className="page-header">
        <div>
          <h1 className="page-title">{site.name}</h1>
          <p className="page-subtitle">{siteAddress}</p>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexWrap: 'wrap' }}>
          <Link href={`/compliance/${siteId}/certificate-pack`} className="filter-tab">
            ↓ Certificate Pack
          </Link>
          <ReportButton type="compliance" entityId={siteId} label="↓ COC Report" />
          <a
            href={`${process.env.NEXT_PUBLIC_SITE_URL ?? ''}/share/coc/${siteId}`}
            target="_blank"
            rel="noopener noreferrer"
            className="filter-tab"
          >
            Share ↗
          </a>
          <div style={{
            fontFamily: 'var(--font-mono)', fontSize: 18, fontWeight: 700,
            color: scoreColor, letterSpacing: '0.02em',
          }}>
            {score.score}% compliant
          </div>
        </div>
      </div>

      {/* Score breakdown */}
      <div
        className="kpi-grid"
        style={{ display: 'grid', gridTemplateColumns: 'repeat(4, 1fr)', gap: 10, marginBottom: 20 }}
      >
        <div className="kpi-card kpi-success">
          <div className="kpi-value">{score.approved}</div>
          <div className="kpi-label">Approved</div>
        </div>
        <div className={`kpi-card ${score.pending > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-value">{score.pending}</div>
          <div className="kpi-label">Under Review</div>
        </div>
        <div className={`kpi-card ${score.missing > 0 ? 'kpi-danger' : ''}`}>
          <div className="kpi-value">{score.missing}</div>
          <div className="kpi-label">Missing</div>
        </div>
        <div className="kpi-card">
          <div className="kpi-value">{score.total}</div>
          <div className="kpi-label">Total</div>
        </div>
      </div>

      {canManage && pendingReview > 0 && (
        <div
          role="alert"
          style={{
            padding: '12px 16px', borderRadius: 8, marginBottom: 20,
            background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
            color: 'var(--c-amber)', fontSize: 13,
          }}
        >
          {pendingReview} subsection{pendingReview > 1 ? 's' : ''} awaiting review — click a subsection to approve or reject.
        </div>
      )}

      <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 4 }}>
          <h2
            style={{
              fontFamily: 'var(--font-mono)', fontSize: 11, fontWeight: 600,
              letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)',
              margin: 0,
            }}
          >
            Subsections ({subs.length})
          </h2>
          {canManage && <AddSubsectionForm siteId={siteId} />}
        </div>

        {subs.sort((a: any, b: any) => a.sort_order - b.sort_order).map((sub: any) => {
          const uploads = (sub.coc_uploads ?? []) as any[]
          const latest = uploads.sort((a: any, b: any) => b.version - a.version)[0]
          const needsReview = sub.coc_status === 'submitted' || sub.coc_status === 'under_review'
          const emphasize = needsReview && canManage

          return (
            <div
              key={sub.id}
              className="data-panel"
              style={emphasize ? { borderColor: 'var(--c-amber-mid)' } : undefined}
            >
              <div style={{ padding: '14px 18px', display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 16 }}>
                <Link
                  href={`/compliance/${siteId}/${sub.id}`}
                  style={{ flex: 1, textDecoration: 'none', color: 'inherit', display: 'block' }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                    <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>{sub.name}</p>
                    {sub.sans_ref && (
                      <span style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)' }}>
                        {sub.sans_ref}
                      </span>
                    )}
                    {emphasize && (
                      <span className="badge badge-amber">Review needed</span>
                    )}
                  </div>
                  {sub.description && (
                    <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 4 }}>{sub.description}</p>
                  )}
                  {latest && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 8, letterSpacing: '0.04em' }}>
                      Last upload: {formatDate(latest.created_at)} by {latest.uploaded_by_profile?.full_name ?? 'unknown'} · v{latest.version}
                    </p>
                  )}
                  {uploads.length === 0 && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 8, letterSpacing: '0.04em' }}>
                      No COC uploaded yet
                    </p>
                  )}
                </Link>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, flexShrink: 0 }}>
                  {cocStatusBadge(sub.coc_status)}
                  <CocUploadButton subsectionId={sub.id} orgId={orgId} />
                </div>
              </div>
            </div>
          )
        })}

        {subs.length === 0 && (
          <div className="data-panel">
            <div className="data-panel-empty" style={{ padding: '48px 18px' }}>
              No subsections yet.
              {canManage && <div style={{ marginTop: 6, fontSize: 11 }}>Use &quot;Add subsection&quot; above to get started.</div>}
            </div>
          </div>
        )}
      </div>
    </div>
  )
}
