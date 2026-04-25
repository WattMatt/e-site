import type { Metadata } from 'next'
import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'
import Link from 'next/link'

export const metadata: Metadata = { title: 'Compliance' }

const STATUS_META: Record<string, { label: string; className: string }> = {
  approved:   { label: 'APR', className: 'badge badge-green' },
  pending:    { label: 'PND', className: 'badge badge-amber' },
  rejected:   { label: 'REJ', className: 'badge badge-red' },
  not_started:{ label: 'NST', className: 'badge badge-muted' },
}

function statusBadge(status: string) {
  const meta = STATUS_META[status] ?? STATUS_META['not_started']
  return <span className={meta.className} title={status}>{meta.label}</span>
}

function ScoreRing({ score }: { score: number }) {
  const color =
    score === 100 ? 'var(--c-green)' :
    score >= 50   ? 'var(--c-amber)' :
    'var(--c-red)'

  return (
    <div style={{ textAlign: 'right' }}>
      <span className="compliance-score" style={{ color, fontFamily: 'var(--font-mono)' }}>
        {score}%
      </span>
    </div>
  )
}

interface Props {
  searchParams: Promise<{ filter?: string }>
}

export default async function CompliancePage({ searchParams }: Props) {
  const { filter } = await searchParams
  const isPending = filter === 'pending'
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  const sites = membership
    ? await complianceService.listSites(supabase as any, membership.organisation_id)
    : []

  const sitesWithScore = sites.map((site) => {
    const subs = (site.subsections as any[]) ?? []
    const total = subs.length
    const approved = subs.filter((s) => s.coc_status === 'approved').length
    const pending = subs.filter((s) => s.coc_status === 'submitted' || s.coc_status === 'under_review').length
    const score = total > 0 ? Math.round((approved / total) * 100) : 0
    return { ...site, score, total, approved, pending }
  })

  const visibleSites = isPending
    ? sitesWithScore.filter((s) => s.pending > 0)
    : sitesWithScore
  const totalPending = sitesWithScore.reduce((acc, s) => acc + s.pending, 0)

  const overallHealth = sitesWithScore.length > 0
    ? Math.round(sitesWithScore.reduce((acc, s) => acc + s.score, 0) / sitesWithScore.length)
    : null

  return (
    <div className="animate-fadeup">
      {/* Page header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Compliance</h1>
          <p className="page-subtitle">COC status across all sites</p>
        </div>
        <Link
          href="/compliance/new"
          style={{
            display: 'inline-flex',
            alignItems: 'center',
            gap: 8,
            padding: '9px 16px',
            background: 'var(--c-amber)',
            color: '#0D0B09',
            borderRadius: 6,
            fontSize: 13,
            fontWeight: 700,
            textDecoration: 'none',
          }}
        >
          + New Site
        </Link>
      </div>

      {isPending && (
        <div style={{
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
          padding: '10px 14px', marginBottom: 16,
          backgroundColor: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)',
          borderRadius: 8,
        }}>
          <div style={{ fontSize: 13, color: 'var(--c-amber)' }}>
            Showing sites with COCs awaiting review. {totalPending} subsection{totalPending !== 1 ? 's' : ''} pending across {visibleSites.length} site{visibleSites.length !== 1 ? 's' : ''}.
          </div>
          <Link href="/compliance" style={{ fontSize: 12, color: 'var(--c-amber)', textDecoration: 'underline' }}>
            Show all sites
          </Link>
        </div>
      )}

      {/* Summary bar */}
      {sitesWithScore.length > 0 && (
        <div
          className="animate-fadeup animate-fadeup-1"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 20,
            padding: '14px 20px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            marginBottom: 24,
          }}
        >
          <div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 9, letterSpacing: '0.12em', textTransform: 'uppercase', color: 'var(--c-text-dim)', marginBottom: 4 }}>
              Overall Health
            </div>
            <div
              style={{
                fontFamily: 'var(--font-mono)',
                fontSize: 22,
                fontWeight: 700,
                color: overallHealth === null ? 'var(--c-text-dim)' :
                       overallHealth >= 80 ? 'var(--c-green)' :
                       overallHealth >= 50 ? 'var(--c-amber)' : 'var(--c-red)',
              }}
            >
              {overallHealth !== null ? `${overallHealth}%` : '—'}
            </div>
          </div>
          <div style={{ flex: 1, height: 3, background: 'var(--c-elevated)', borderRadius: 2, overflow: 'hidden' }}>
            <div
              style={{
                height: '100%',
                width: `${overallHealth ?? 0}%`,
                background: overallHealth === null ? 'var(--c-border-mid)' :
                            overallHealth >= 80 ? 'var(--c-green)' :
                            overallHealth >= 50 ? 'var(--c-amber)' : 'var(--c-red)',
                borderRadius: 2,
                transition: 'width 0.4s ease',
              }}
            />
          </div>
          <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', whiteSpace: 'nowrap' }}>
            {sitesWithScore.length} {sitesWithScore.length === 1 ? 'site' : 'sites'}
          </div>
        </div>
      )}

      {sites.length === 0 ? (
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            justifyContent: 'center',
            padding: '80px 24px',
            background: 'var(--c-panel)',
            border: '1px solid var(--c-border)',
            borderRadius: 8,
            textAlign: 'center',
            gap: 12,
          }}
        >
          <div style={{
            width: 48,
            height: 48,
            background: 'var(--c-elevated)',
            borderRadius: 8,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
          }}>
            <svg viewBox="0 0 24 24" fill="none" stroke="var(--c-amber)" strokeWidth="1.5" width="24" height="24">
              <path d="M12 2L20 6v6c0 5-8 10-8 10S4 17 4 12V6l8-4z" />
              <polyline points="8,12 11,15 16,9" />
            </svg>
          </div>
          <div>
            <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--c-text)', marginBottom: 6 }}>No compliance sites yet</div>
            <div style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' }}>
              Add your first site to start tracking COC status
            </div>
          </div>
          <Link
            href="/compliance/new"
            style={{
              padding: '10px 20px',
              background: 'var(--c-amber)',
              color: '#0D0B09',
              borderRadius: 6,
              fontSize: 13,
              fontWeight: 700,
              textDecoration: 'none',
              marginTop: 4,
            }}
          >
            Add Site
          </Link>
        </div>
      ) : (
        <div
          className="animate-fadeup animate-fadeup-2"
          style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 14 }}
        >
          {visibleSites.map((site) => (
            <Link key={site.id} href={`/compliance/${site.id}`} className="compliance-card bracket-card">
              <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: 12 }}>
                <div>
                  <div style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)', lineHeight: 1.2 }}>{site.name}</div>
                  <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 3, letterSpacing: '0.04em' }}>
                    {site.address}
                  </div>
                </div>
                <ScoreRing score={site.score} />
              </div>

              {/* Progress track */}
              <div className="score-track">
                <div
                  className="score-fill"
                  style={{
                    width: `${site.score}%`,
                    background: site.score === 100 ? 'var(--c-green)' :
                                site.score >= 50 ? 'var(--c-amber)' : 'var(--c-red)',
                  }}
                />
              </div>

              {/* Sub-section status pills */}
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
                {((site.subsections as any[]) ?? []).slice(0, 8).map((sub: any) => (
                  <span key={sub.id} title={sub.name}>
                    {statusBadge(sub.coc_status)}
                  </span>
                ))}
                {((site.subsections as any[]) ?? []).length > 8 && (
                  <span style={{ fontFamily: 'var(--font-mono)', fontSize: 9, color: 'var(--c-text-dim)' }}>
                    +{(site.subsections as any[]).length - 8}
                  </span>
                )}
              </div>

              <div style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.06em' }}>
                {site.approved}/{site.total} sections approved
              </div>
            </Link>
          ))}
        </div>
      )}
    </div>
  )
}
