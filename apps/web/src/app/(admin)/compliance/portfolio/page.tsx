import { createClient } from '@/lib/supabase/server'
import { redirect } from 'next/navigation'
import Link from 'next/link'

function scoreColor(score: number) {
  if (score >= 80) return '#4ade80'
  if (score >= 50) return 'var(--c-amber)'
  return 'var(--c-red)'
}

function trafficLight(score: number) {
  if (score >= 80) return { label: 'Compliant', dot: '#4ade80' }
  if (score >= 50) return { label: 'At Risk', dot: 'var(--c-amber)' }
  return { label: 'Non-Compliant', dot: 'var(--c-red)' }
}

export default async function CompliancePortfolioPage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) redirect('/login')

  const { data: membership } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user.id)
    .eq('is_active', true)
    .limit(1)
    .single()

  if (!membership) redirect('/login')

  const orgId = membership.organisation_id

  const { data: sitesRaw } = await supabase
    .schema('compliance')
    .from('sites')
    .select(`
      id, name, address, city, province, status, created_at,
      subsections (
        id, name, coc_status, sans_ref, sort_order,
        coc_uploads (
          id, status, created_at, reviewed_at
        )
      )
    `)
    .eq('organisation_id', orgId)
    .order('name', { ascending: true })

  const sites = sitesRaw ?? []

  const sitesWithMetrics = sites.map((site: any) => {
    const subs: any[] = site.subsections ?? []
    const total = subs.length
    const approved = subs.filter((s: any) => s.coc_status === 'approved').length
    const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
    const missing = subs.filter((s: any) => ['missing', 'rejected'].includes(s.coc_status)).length
    const score = total > 0 ? Math.round((approved / total) * 100) : 0

    const allUploads = subs.flatMap((s: any) => s.coc_uploads ?? [])
    allUploads.sort((a: any, b: any) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
    const lastActivity = allUploads[0]?.created_at ?? null

    return { ...site, total, approved, pending, missing, score, lastActivity }
  })

  const totalSubs = sitesWithMetrics.reduce((s, x) => s + x.total, 0)
  const totalApproved = sitesWithMetrics.reduce((s, x) => s + x.approved, 0)
  const totalPending = sitesWithMetrics.reduce((s, x) => s + x.pending, 0)
  const totalMissing = sitesWithMetrics.reduce((s, x) => s + x.missing, 0)
  const portfolioScore = totalSubs > 0 ? Math.round((totalApproved / totalSubs) * 100) : 0

  const compliantSites = sitesWithMetrics.filter(s => s.score >= 80).length
  const atRiskSites = sitesWithMetrics.filter(s => s.score >= 50 && s.score < 80).length
  const nonCompliantSites = sitesWithMetrics.filter(s => s.score < 50).length

  const portfolioColor = scoreColor(portfolioScore)
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL

  const mono11 = { fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', letterSpacing: '0.04em' } as const
  const thStyle: React.CSSProperties = { padding: '12px 18px', fontFamily: 'var(--font-mono)', fontSize: 10, fontWeight: 600, letterSpacing: '0.1em', textTransform: 'uppercase', color: 'var(--c-text-dim)', textAlign: 'left' }

  return (
    <div className="animate-fadeup" style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
      {/* Header */}
      <div className="page-header">
        <div>
          <h1 className="page-title">Compliance Portfolio</h1>
          <p className="page-subtitle">Portfolio-wide COC health across {sites.length} site{sites.length !== 1 ? 's' : ''}</p>
        </div>
        <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap' }}>
          <Link href="/compliance" className="filter-tab">← Sites</Link>
          <a
            href={`${supabaseUrl}/functions/v1/generate-report?orgId=${orgId}&type=compliance_portfolio`}
            target="_blank"
            rel="noopener noreferrer"
            className="filter-tab"
          >
            ↓ Export PDF
          </a>
        </div>
      </div>

      {/* Portfolio score + KPI strip */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr 1fr 1fr', gap: 10 }}>
        <div
          className="data-panel"
          style={{ borderColor: portfolioColor, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', padding: '22px 16px' }}
        >
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', letterSpacing: '0.12em', textTransform: 'uppercase', marginBottom: 6 }}>
            Portfolio Score
          </p>
          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 44, fontWeight: 800, color: portfolioColor, lineHeight: 1 }}>
            {portfolioScore}%
          </p>
          <p style={{ ...mono11, marginTop: 8 }}>{totalApproved} / {totalSubs} approved</p>
        </div>

        <div className="kpi-card kpi-success">
          <div className="kpi-value">{totalApproved}</div>
          <div className="kpi-label">Approved COCs</div>
          <div style={{ width: '100%', height: 3, background: 'var(--c-elevated)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: '#4ade80', width: totalSubs > 0 ? `${(totalApproved / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>

        <div className={`kpi-card ${totalPending > 0 ? 'kpi-warning' : ''}`}>
          <div className="kpi-value">{totalPending}</div>
          <div className="kpi-label">Pending Review</div>
          <div style={{ width: '100%', height: 3, background: 'var(--c-elevated)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--c-amber)', width: totalSubs > 0 ? `${(totalPending / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>

        <div className={`kpi-card ${totalMissing > 0 ? 'kpi-danger' : ''}`}>
          <div className="kpi-value">{totalMissing}</div>
          <div className="kpi-label">Missing / Rejected</div>
          <div style={{ width: '100%', height: 3, background: 'var(--c-elevated)', borderRadius: 2, marginTop: 8, overflow: 'hidden' }}>
            <div style={{ height: '100%', background: 'var(--c-red)', width: totalSubs > 0 ? `${(totalMissing / totalSubs) * 100}%` : '0%' }} />
          </div>
        </div>
      </div>

      {/* Traffic light band */}
      <div style={{ display: 'flex', gap: 18, fontSize: 13 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#4ade80' }} />
          <span style={{ color: 'var(--c-text-mid)' }}>{compliantSites} Compliant</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--c-amber)' }} />
          <span style={{ color: 'var(--c-text-mid)' }}>{atRiskSites} At Risk</span>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <span style={{ width: 10, height: 10, borderRadius: '50%', background: 'var(--c-red)' }} />
          <span style={{ color: 'var(--c-text-mid)' }}>{nonCompliantSites} Non-Compliant</span>
        </div>
      </div>

      {/* Per-site table */}
      {sites.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '60px 24px' }}>
            No compliance sites found for this organisation.
            <div style={{ marginTop: 14 }}>
              <Link href="/compliance/new" className="btn-primary-amber" style={{ padding: '9px 18px', textDecoration: 'none' }}>
                Add First Site
              </Link>
            </div>
          </div>
        </div>
      ) : (
        <div className="data-panel" style={{ overflow: 'hidden' }}>
          <div className="data-panel-header">
            <span className="data-panel-title">Site-by-Site Breakdown</span>
            <span style={mono11}>{sites.length} sites</span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
              <thead>
                <tr style={{ borderBottom: '1px solid var(--c-border)' }}>
                  <th style={thStyle}>Site</th>
                  <th style={thStyle}>Status</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Score</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Approved</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Pending</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Missing</th>
                  <th style={{ ...thStyle, textAlign: 'right' }}>Total</th>
                  <th style={thStyle}>Progress</th>
                </tr>
              </thead>
              <tbody>
                {sitesWithMetrics.map((site) => {
                  const tl = trafficLight(site.score)
                  const sc = scoreColor(site.score)
                  return (
                    <tr key={site.id} style={{ borderBottom: '1px solid var(--c-border)' }}>
                      <td style={{ padding: '12px 18px' }}>
                        <Link
                          href={`/compliance/${site.id}`}
                          style={{ color: 'var(--c-text)', textDecoration: 'none', fontWeight: 500 }}
                        >
                          {site.name}
                        </Link>
                        {(site.city || site.province) && (
                          <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2 }}>
                            {[site.city, site.province].filter(Boolean).join(', ')}
                          </p>
                        )}
                      </td>
                      <td style={{ padding: '12px 18px' }}>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                          <span style={{ width: 8, height: 8, borderRadius: '50%', background: tl.dot }} />
                          <span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{tl.label}</span>
                        </span>
                      </td>
                      <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: sc, fontFamily: 'var(--font-mono)' }}>{site.score}%</td>
                      <td style={{ padding: '12px 18px', textAlign: 'right', color: '#4ade80', fontFamily: 'var(--font-mono)' }}>{site.approved}</td>
                      <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{site.pending}</td>
                      <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--c-red)', fontFamily: 'var(--font-mono)' }}>{site.missing}</td>
                      <td style={{ padding: '12px 18px', textAlign: 'right', color: 'var(--c-text-dim)', fontFamily: 'var(--font-mono)' }}>{site.total}</td>
                      <td style={{ padding: '12px 18px', width: 140 }}>
                        <div style={{ width: '100%', background: 'var(--c-elevated)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                          <div style={{ height: '100%', background: sc, width: `${site.score}%`, transition: 'width 0.3s' }} />
                        </div>
                      </td>
                    </tr>
                  )
                })}
              </tbody>
              <tfoot>
                <tr style={{ borderTop: '2px solid var(--c-border)', background: 'var(--c-elevated)' }}>
                  <td colSpan={2} style={{ padding: '12px 18px', fontWeight: 600, color: 'var(--c-text)' }}>Portfolio Total</td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 700, color: portfolioColor, fontFamily: 'var(--font-mono)' }}>{portfolioScore}%</td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 600, color: '#4ade80', fontFamily: 'var(--font-mono)' }}>{totalApproved}</td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 600, color: 'var(--c-amber)', fontFamily: 'var(--font-mono)' }}>{totalPending}</td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 600, color: 'var(--c-red)', fontFamily: 'var(--font-mono)' }}>{totalMissing}</td>
                  <td style={{ padding: '12px 18px', textAlign: 'right', fontWeight: 600, color: 'var(--c-text-mid)', fontFamily: 'var(--font-mono)' }}>{totalSubs}</td>
                  <td style={{ padding: '12px 18px', width: 140 }}>
                    <div style={{ width: '100%', background: 'var(--c-elevated)', borderRadius: 2, height: 4, overflow: 'hidden' }}>
                      <div style={{ height: '100%', background: portfolioColor, width: `${portfolioScore}%` }} />
                    </div>
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </div>
      )}

      {/* Outstanding COCs */}
      {sitesWithMetrics.some(s => s.missing > 0 || s.pending > 0) && (
        <div className="data-panel" style={{ borderColor: 'var(--c-amber-mid)', overflow: 'hidden' }}>
          <div className="data-panel-header" style={{ background: 'var(--c-amber-dim)' }}>
            <div>
              <span className="data-panel-title" style={{ color: 'var(--c-amber)' }}>Outstanding COCs requiring attention</span>
              <p style={{ fontSize: 11, color: 'var(--c-amber)', opacity: 0.7, marginTop: 2 }}>
                Subsections with missing or rejected COC uploads
              </p>
            </div>
          </div>
          <div>
            {sitesWithMetrics
              .filter(s => s.missing > 0 || s.pending > 0)
              .flatMap(site =>
                (site.subsections as any[])
                  .filter((sub: any) => ['missing', 'rejected'].includes(sub.coc_status))
                  .map((sub: any) => ({ site, sub }))
              )
              .map(({ site, sub }) => (
                <div
                  key={sub.id}
                  style={{
                    padding: '12px 18px',
                    borderBottom: '1px solid var(--c-border)',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 12,
                  }}
                >
                  <div>
                    <p style={{ fontSize: 13, color: 'var(--c-text)' }}>{sub.name}</p>
                    <p style={{ fontFamily: 'var(--font-mono)', fontSize: 10, color: 'var(--c-text-dim)', marginTop: 2, letterSpacing: '0.04em' }}>
                      {site.name}{sub.sans_ref ? ` · SANS ${sub.sans_ref}` : ''}
                    </p>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <span className={sub.coc_status === 'rejected' ? 'badge badge-red' : 'badge badge-muted'}>
                      {sub.coc_status === 'rejected' ? 'Rejected' : 'Missing'}
                    </span>
                    <Link
                      href={`/compliance/${site.id}#${sub.id}`}
                      style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-amber)', textDecoration: 'none', letterSpacing: '0.04em' }}
                    >
                      View →
                    </Link>
                  </div>
                </div>
              ))
            }
          </div>
        </div>
      )}
    </div>
  )
}
