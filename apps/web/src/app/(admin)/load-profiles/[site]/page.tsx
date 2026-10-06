/**
 * One metered site from the meter library: every meter as a source, its role from its type, and the
 * profile built by the bulk rule. Read-only; reference year and power factor from the query string.
 */
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { createClient } from '@/lib/supabase/server'
import { requireRolePage } from '@/lib/auth/require-role'
import { ARCHIVE_READ_ROLES } from '@/lib/load-profile/access'
import { archiveSettings, loadArchiveSiteView, siteFromParam } from '@/lib/load-profile/archive'
import type { AnyClient } from '@/lib/load-profile/load'
import { formatNumber } from '@/components/charts/scale'
import { OutputsPanel } from '../../projects/[id]/load-profile/_components/OutputsPanel'

export const dynamic = 'force-dynamic'
export const maxDuration = 60

const ROLE_LABEL: Record<string, string> = { bulk: 'Bulk supply', tenant: 'Tenant', addition: 'Addition', check: 'Check (not added)', submain: 'Sub-supply (not added)', solar: 'Solar (not added)', generator: 'Generator (not added)' }

export default async function LoadProfileSitePage({ params, searchParams }: { params: Promise<{ site: string }>; searchParams: Promise<{ year?: string; pf?: string }> }) {
  await requireRolePage(ARCHIVE_READ_ROLES)
  const site = siteFromParam((await params).site)
  const settings = archiveSettings(await searchParams)
  const supabase = (await createClient()) as unknown as AnyClient
  const view = await loadArchiveSiteView(supabase, site, settings)
  if (!view) notFound()
  const hasBulk = view.sources.some((s) => s.role === 'bulk' && s.counted)
  const exportHref = (format: 'xlsx' | 'pdf') => `/api/load-profiles/${encodeURIComponent(site)}/export?format=${format}&year=${settings.referenceYear}&pf=${settings.powerFactor}`
  return (
    <div className="page">
      <div className="page-header">
        <div>
          <p className="page-subtitle"><Link href="/load-profiles">Load profiles</Link></p>
          <h1 className="page-title">{site}</h1>
          <p className="page-subtitle">{view.sources.length} meter{view.sources.length === 1 ? '' : 's'} · reference year {settings.referenceYear} · power factor {settings.powerFactor}</p>
        </div>
        {view.analysis && (
          <div style={{ display: 'flex', gap: 8 }}>
            <a className="btn" href={exportHref('xlsx')}>Export Excel</a>
            <a className="btn" href={exportHref('pdf')}>Export PDF</a>
          </div>
        )}
      </div>

      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Meters</h2>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead><tr><th>Meter</th><th>Role</th><th style={{ textAlign: 'right' }}>kWh / year</th><th style={{ textAlign: 'right' }}>Peak kW</th><th>Detail</th></tr></thead>
          <tbody>
            {view.sources.map((s) => (
              <tr key={s.id} style={{ opacity: s.counted ? 1 : 0.6 }}>
                <td>{s.label}</td>
                <td>{ROLE_LABEL[s.role] ?? s.role}{s.status === 'ok' && !s.counted ? <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>not added</div> : null}</td>
                <td style={{ textAlign: 'right' }}>{s.annualKwh == null ? '—' : formatNumber(s.annualKwh)}</td>
                <td style={{ textAlign: 'right' }}>{s.peakKw == null ? '—' : formatNumber(s.peakKw, 1)}</td>
                <td style={{ fontSize: 12 }}>{s.status === 'error' ? <span style={{ color: 'var(--c-red)' }}>{s.error}</span> : s.detail}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {view.compositionNote && <p style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '6px 0 0' }}>{view.compositionNote} Roles come from each meter&apos;s type, read from its label.</p>}
        {!hasBulk && view.analysis && (
          <p style={{ fontSize: 12, color: 'var(--c-amber)', margin: '6px 0 0' }}>
            No bulk meter was loaded for this site, so this is the sum of the meters that were loaded: any supply without its own meter here (common areas, landlord, plant) is not in it. Treat the peak and the NMD suggestion as a floor, not the site&apos;s demand.
          </p>
        )}
      </div>

      {view.analysis ? (
        <OutputsPanel view={view} costHint="To cost this site against a tariff, add its meters to a project's Load profile tab (Add meters from the Solar library)." />
      ) : (
        <div className="card empty-state" style={{ marginTop: 16 }}><p>None of this site&apos;s meters can be added up (every meter is a check, sub-supply, solar or generator meter, or has no readings).</p></div>
      )}
    </div>
  )
}
