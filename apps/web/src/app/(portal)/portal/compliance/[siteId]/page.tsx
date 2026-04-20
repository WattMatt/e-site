import { notFound } from 'next/navigation'
import Link from 'next/link'
import { createClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'
import { CopyLinkButton } from './CopyLinkButton'

interface Props { params: Promise<{ siteId: string }> }

const STATUS_STYLES: Record<string, { dotColor: string; labelColor: string; label: string }> = {
  approved: { dotColor: '#4ade80', labelColor: '#4ade80', label: 'Approved' },
  submitted: { dotColor: 'var(--c-blue)', labelColor: 'var(--c-amber)', label: 'Submitted' },
  under_review: { dotColor: 'var(--c-amber)', labelColor: 'var(--c-amber)', label: 'Under Review' },
  rejected: { dotColor: 'var(--c-red)', labelColor: 'var(--c-red)', label: 'Rejected' },
  missing: { dotColor: 'var(--c-text-dim)', labelColor: 'var(--c-red)', label: 'Missing' },
}

export default async function PortalSiteDetailPage({ params }: Props) {
  const { siteId } = await params
  const supabase = await createClient()

  const site = await complianceService.getSite(supabase as any, siteId).catch(() => null)
  if (!site) notFound()

  const score = await complianceService.getSiteComplianceScore(supabase as any, siteId)
  const subs = (site.subsections as any[]) ?? []
  const siteUrl = `${process.env.NEXT_PUBLIC_SITE_URL}/share/coc/${siteId}`

  const scoreColor = score.score === 100 ? '#4ade80' : score.score >= 50 ? 'var(--c-amber)' : 'var(--c-red)'

  return (
    <div className="animate-fadeup">
      <div style={{ marginBottom: 16 }}>
        <Link
          href="/portal/compliance"
          style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', textDecoration: 'none', letterSpacing: '0.06em' }}
        >
          ← All Sites
        </Link>
      </div>

      <div className="page-header" style={{ alignItems: 'flex-start' }}>
        <div>
          <h1 className="page-title">{site.name}</h1>
          <p className="page-subtitle">
            {(site as any).address}{(site as any).city ? `, ${(site as any).city}` : ''}
          </p>
        </div>
        <div style={{ fontSize: 28, fontWeight: 700, color: scoreColor, flexShrink: 0 }}>
          {score.score}%
        </div>
      </div>

      {/* Score summary */}
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(3, 1fr)',
          gap: 10,
          marginBottom: 20,
        }}
      >
        <div className="data-panel" style={{ padding: '16px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 22, fontWeight: 700, color: '#4ade80' }}>{score.approved}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Approved
          </p>
        </div>
        <div className="data-panel" style={{ padding: '16px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-amber)' }}>{score.pending}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Under Review
          </p>
        </div>
        <div className="data-panel" style={{ padding: '16px 14px', textAlign: 'center' }}>
          <p style={{ fontSize: 22, fontWeight: 700, color: 'var(--c-red)' }}>{score.missing}</p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 4, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
            Missing
          </p>
        </div>
      </div>

      {/* Shareable link */}
      <div
        className="data-panel"
        style={{
          padding: '14px 18px',
          marginBottom: 16,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          gap: 12,
        }}
      >
        <div style={{ minWidth: 0, flex: 1 }}>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.08em', textTransform: 'uppercase', marginBottom: 4 }}>
            Shareable link
          </p>
          <p
            style={{
              fontFamily: 'var(--font-mono)',
              fontSize: 11,
              color: 'var(--c-text-mid)',
              overflow: 'hidden',
              textOverflow: 'ellipsis',
              whiteSpace: 'nowrap',
            }}
          >
            {siteUrl}
          </p>
        </div>
        <CopyLinkButton url={siteUrl} />
      </div>

      {/* Subsections */}
      <div className="data-panel">
        {subs.sort((a: any, b: any) => a.sort_order - b.sort_order).map((sub: any, idx: number) => {
          const style = STATUS_STYLES[sub.coc_status] ?? STATUS_STYLES.missing
          const uploads = sub.coc_uploads ?? []
          const latest = uploads[uploads.length - 1]
          return (
            <div
              key={sub.id}
              style={{
                padding: '14px 18px',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 12,
                borderTop: idx > 0 ? '1px solid var(--c-border)' : 'none',
              }}
            >
              <div style={{ display: 'flex', alignItems: 'center', gap: 12, minWidth: 0, flex: 1 }}>
                <div
                  style={{
                    width: 10,
                    height: 10,
                    borderRadius: '50%',
                    background: style.dotColor,
                    flexShrink: 0,
                  }}
                />
                <div style={{ minWidth: 0 }}>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--c-text)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {sub.name}
                  </p>
                  {sub.sans_ref && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2, letterSpacing: '0.04em' }}>
                      {sub.sans_ref}
                    </p>
                  )}
                  {latest && (
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                      Updated {formatDate(latest.created_at)} · v{latest.version}
                    </p>
                  )}
                </div>
              </div>
              <span
                style={{
                  fontFamily: 'var(--font-mono)',
                  fontSize: 11,
                  fontWeight: 600,
                  color: style.labelColor,
                  flexShrink: 0,
                  letterSpacing: '0.04em',
                }}
              >
                {style.label}
              </span>
            </div>
          )
        })}
      </div>
    </div>
  )
}
