import { createClient } from '@/lib/supabase/server'
import { complianceService } from '@esite/shared'
import Link from 'next/link'

function ScoreRing({ score }: { score: number }) {
  const color = score === 100 ? '#4ade80' : score >= 50 ? 'var(--c-amber)' : 'var(--c-red)'
  return (
    <div
      style={{
        width: 56,
        height: 56,
        borderRadius: '50%',
        border: `3px solid ${color}`,
        color,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        fontSize: 13,
        fontWeight: 700,
        flexShrink: 0,
      }}
    >
      {score}%
    </div>
  )
}

export default async function PortalCompliancePage() {
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()

  const { data: memRaw } = await supabase
    .from('user_organisations')
    .select('organisation_id')
    .eq('user_id', user!.id)
    .eq('is_active', true)
    .limit(1)
    .single()
  const mem = memRaw as { organisation_id: string } | null

  const sites = mem
    ? await complianceService.listSites(supabase as any, mem.organisation_id).catch(() => [])
    : []

  return (
    <div className="animate-fadeup">
      <div className="page-header">
        <div>
          <h1 className="page-title">Compliance Status</h1>
          <p className="page-subtitle">Read-only view of your project COC compliance</p>
        </div>
      </div>

      {sites.length === 0 ? (
        <div className="data-panel">
          <div className="data-panel-empty" style={{ padding: '60px 24px', textAlign: 'center' }}>
            <div style={{ fontSize: 36, marginBottom: 12 }}>📋</div>
            <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>No sites found</p>
            <p style={{ fontFamily: 'var(--font-mono)', fontSize: 11, color: 'var(--c-text-dim)', marginTop: 6, letterSpacing: '0.04em' }}>
              Your contractor will share compliance status here.
            </p>
          </div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {sites.map((site: any) => {
            const subs = site.subsections ?? []
            const total = subs.length
            const approved = subs.filter((s: any) => s.coc_status === 'approved').length
            const pending = subs.filter((s: any) => ['submitted', 'under_review'].includes(s.coc_status)).length
            const missing = total - approved - pending
            const score = total === 0 ? 0 : Math.round((approved / total) * 100)

            return (
              <Link
                key={site.id}
                href={`/portal/compliance/${site.id}`}
                className="data-panel"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 16,
                  padding: '18px 20px',
                  textDecoration: 'none',
                  color: 'inherit',
                }}
              >
                <ScoreRing score={score} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <p style={{ fontSize: 14, fontWeight: 600, color: 'var(--c-text)' }}>{site.name}</p>
                  <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 2 }}>
                    {site.address}{site.city ? `, ${site.city}` : ''}
                  </p>
                  <div
                    style={{
                      display: 'flex',
                      gap: 14,
                      marginTop: 10,
                      fontFamily: 'var(--font-mono)',
                      fontSize: 11,
                      letterSpacing: '0.04em',
                    }}
                  >
                    <span style={{ color: '#4ade80' }}>{approved} approved</span>
                    <span style={{ color: 'var(--c-amber)' }}>{pending} pending</span>
                    <span style={{ color: 'var(--c-red)' }}>{missing} missing</span>
                    <span style={{ color: 'var(--c-text-dim)' }}>{total} total</span>
                  </div>
                </div>
                <span style={{ color: 'var(--c-text-dim)', fontSize: 18 }}>›</span>
              </Link>
            )
          })}
        </div>
      )}
    </div>
  )
}
