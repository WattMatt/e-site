import { notFound } from 'next/navigation'
import { createServiceClient } from '@/lib/supabase/server'
import { complianceService, formatDate } from '@esite/shared'

interface Props { params: Promise<{ siteId: string }> }

const STATUS_CONFIG: Record<string, { label: string; cls: string }> = {
  approved: { label: 'Approved', cls: 'badge badge-green' },
  submitted: { label: 'Submitted', cls: 'badge badge-blue' },
  under_review: { label: 'Under Review', cls: 'badge badge-amber' },
  rejected: { label: 'Rejected', cls: 'badge badge-red' },
  missing: { label: 'Missing', cls: 'badge badge-muted' },
}

export default async function ShareCocPage({ params }: Props) {
  const { siteId } = await params
  const supabase = await createServiceClient()

  const [site, score] = await Promise.all([
    complianceService.getSite(supabase as any, siteId).catch(() => null),
    complianceService.getSiteComplianceScore(supabase as any, siteId).catch(() => null),
  ])

  if (!site) notFound()

  const subs = (site.subsections as any[]) ?? []
  const sortedSubs = subs.sort((a: any, b: any) => a.sort_order - b.sort_order)
  const generatedAt = new Date().toLocaleDateString('en-ZA', { day: 'numeric', month: 'long', year: 'numeric' })

  const scoreColor = !score
    ? 'var(--c-text)'
    : score.score === 100
      ? '#4ade80'
      : score.score >= 50
        ? 'var(--c-amber)'
        : 'var(--c-red)'

  return (
    <div
      style={{
        minHeight: '100vh',
        background: 'var(--c-base)',
        display: 'flex',
        justifyContent: 'center',
        alignItems: 'flex-start',
        padding: '48px 16px',
      }}
    >
      <div style={{ width: '100%', maxWidth: 640 }}>
        {/* Header */}
        <div style={{ textAlign: 'center', marginBottom: 32 }}>
          <div
            style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: 8,
              background: 'var(--c-panel)',
              border: '1px solid var(--c-border)',
              borderRadius: 999,
              padding: '8px 16px',
              marginBottom: 24,
            }}
          >
            <span style={{ color: 'var(--c-amber)', fontWeight: 700, fontSize: 13, letterSpacing: '0.04em' }}>
              E-Site
            </span>
            <span style={{ color: 'var(--c-text-dim)', fontSize: 11, fontFamily: 'var(--font-mono)', letterSpacing: '0.06em' }}>
              COC Status Report
            </span>
          </div>
          <h1 className="page-title" style={{ marginBottom: 4 }}>{site.name}</h1>
          <p className="page-subtitle">
            {(site as any).address}{(site as any).city ? `, ${(site as any).city}` : ''}
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 8, letterSpacing: '0.06em' }}>
            Generated {generatedAt}
          </p>
        </div>

        {/* Score */}
        {score && (
          <div
            className="data-panel animate-fadeup"
            style={{ padding: 24, marginBottom: 16, textAlign: 'center' }}
          >
            <div style={{ fontSize: 48, fontWeight: 900, color: scoreColor, lineHeight: 1, marginBottom: 6 }}>
              {score.score}%
            </div>
            <p style={{ fontSize: 13, color: 'var(--c-text-mid)', fontWeight: 500, marginBottom: 14 }}>
              Compliance Score
            </p>
            <div
              style={{
                display: 'flex',
                justifyContent: 'center',
                gap: 20,
                fontFamily: 'var(--font-mono)',
                fontSize: 11,
                letterSpacing: '0.04em',
              }}
            >
              <span style={{ color: '#4ade80' }}>{score.approved} approved</span>
              <span style={{ color: 'var(--c-amber)' }}>{score.pending} pending</span>
              <span style={{ color: 'var(--c-red)' }}>{score.missing} missing</span>
            </div>
          </div>
        )}

        {/* Subsections */}
        <div className="data-panel" style={{ marginBottom: 32 }}>
          {sortedSubs.map((sub: any, idx: number) => {
            const cfg = STATUS_CONFIG[sub.coc_status] ?? STATUS_CONFIG.missing
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
                <div style={{ minWidth: 0, flex: 1 }}>
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
                      Last updated {formatDate(latest.created_at)}
                    </p>
                  )}
                </div>
                <span className={cfg.cls}>{cfg.label}</span>
              </div>
            )
          })}
        </div>

        {/* Footer */}
        <div
          style={{
            textAlign: 'center',
            fontFamily: 'var(--font-mono)',
            fontSize: 10,
            color: 'var(--c-text-dim)',
            borderTop: '1px solid var(--c-border)',
            paddingTop: 20,
            letterSpacing: '0.04em',
          }}
        >
          <p>This report was generated by E-Site — Construction Management Platform</p>
          <p style={{ marginTop: 4 }}>For verification, contact the issuing contractor directly.</p>
        </div>
      </div>
    </div>
  )
}

export const dynamic = 'force-dynamic'
