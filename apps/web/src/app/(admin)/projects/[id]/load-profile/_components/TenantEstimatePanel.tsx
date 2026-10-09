'use client'
/**
 * How a tenant-schedule estimate was built: each tenant from its brand's measured stores per m²
 * (scaled to its own area) or from the generic figures, the stores behind each brand, and the
 * stores left out with the reason. Basis switch and Refresh for the write roles.
 */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { refreshTenantBenchmarksAction, setTenantEstimateBasisAction } from '@/actions/load-profile.actions'
import type { SourceView, TenantEstimateView } from '@/lib/load-profile/view-types'
import { formatNumber } from '@/components/charts/scale'

const range = (r: { median: number; low: number; high: number }, unit: string) => `${formatNumber(r.median)} ${unit} (${formatNumber(r.low)}–${formatNumber(r.high)})`

export function TenantEstimatePanel({ projectId, source, est, canEdit }: { projectId: string; source: SourceView; est: TenantEstimateView; canEdit: boolean }) {
  const router = useRouter()
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  async function run(p: Promise<{ ok: true } | { error: string }>) {
    setBusy(true)
    setError(null)
    try {
      const r = await p
      if ('error' in r) setError(r.error)
      router.refresh()
    } catch {
      setError('That did not finish (the connection or the server timed out). Try again.')
    } finally {
      setBusy(false)
    }
  }
  const fromStores = est.lines.filter((l) => l.basis === 'benchmark').length
  return (
    <details style={{ marginTop: 10, border: '1px solid var(--c-border)', borderRadius: 8, padding: 10, fontSize: 13 }}>
      <summary style={{ cursor: 'pointer', fontWeight: 600 }}>
        {source.label}: {est.basis === 'measured' ? `${fromStores} of ${est.lines.length} tenants from measured stores of their brand` : `${est.lines.length} tenants from generic figures`}
      </summary>
      <p style={{ margin: '8px 0', color: 'var(--c-text-mid)' }}>
        {est.basis === 'measured'
          ? 'A tenant whose brand has measured stores in the library uses their median kWh per m² a year and their average daily pattern, scaled to the tenant’s own area. Stores of the same brand vary, so the range across them is shown; fixed loads (a bakery, a butchery) do not shrink with floor area, so treat a much smaller or larger shop with care. Other tenants use the generic figures for their category.'
          : 'Every tenant is its area × the category’s generic W/m² × a generic daily pattern. Switch to measured stores to use the library’s metered shops of the same brand, per m².'}
      </p>
      {canEdit && (
        <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap', marginBottom: 8 }}>
          <label>Estimate from{' '}
            <select aria-label="Estimate basis" value={est.basis} disabled={busy} onChange={(e) => void run(setTenantEstimateBasisAction(projectId, source.id, e.target.value as TenantEstimateView['basis']))}>
              <option value="measured">measured stores of the brand, per m²</option>
              <option value="generic">generic figures</option>
            </select>
          </label>
          {est.basis === 'measured' && (
            <button className="btn btn-sm" disabled={busy} onClick={() => void run(refreshTenantBenchmarksAction(projectId, source.id))}>
              {busy ? 'Reading the library…' : 'Refresh from the library'}
            </button>
          )}
          {est.computedAt && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>benchmarks read {est.computedAt.slice(0, 10)}</span>}
        </div>
      )}
      {error && <p style={{ color: 'var(--c-red)', margin: '0 0 8px' }}>{error}</p>}

      {est.brands.length > 0 && (
        <>
          <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>Brands matched in the library</h4>
          <table className="table" style={{ width: '100%', fontSize: 12 }}>
            <thead><tr><th>Brand</th><th style={{ textAlign: 'right' }}>Stores</th><th>kWh / m² a year</th><th>Peak W / m²</th><th>Stores used and left out</th></tr></thead>
            <tbody>
              {est.brands.map((b) => (
                <tr key={b.key}>
                  <td>{b.label}</td>
                  <td style={{ textAlign: 'right' }}>{b.n}</td>
                  <td>{range(b.kwhPerM2, '')}</td>
                  <td>{range(b.peakWPerM2, '')}</td>
                  <td>
                    {b.stores.map((s) => `${s.site} (${formatNumber(s.areaM2)} m², ${formatNumber(s.kwhPerM2)} kWh/m²)`).join('; ')}
                    {b.excluded.length > 0 && (
                      <div style={{ color: 'var(--c-text-dim)' }}>Left out: {b.excluded.map((x) => `${x.site}: ${x.reason}`).join('; ')}</div>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </>
      )}
      {est.basis === 'measured' && est.unmatched.length > 0 && (
        <p style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>No qualifying measured store in the library for: {est.unmatched.join(', ')}. These use the generic figures.</p>
      )}

      <h4 style={{ fontSize: 13, margin: '8px 0 4px' }}>Tenants</h4>
      <div style={{ maxHeight: 320, overflowY: 'auto' }}>
        <table className="table" style={{ width: '100%', fontSize: 12 }}>
          <thead><tr><th>Tenant</th><th style={{ textAlign: 'right' }}>Area m²</th><th>Basis</th><th style={{ textAlign: 'right' }}>kWh / year</th><th style={{ textAlign: 'right' }}>Peak kW</th></tr></thead>
          <tbody>
            {est.lines.map((l, i) => (
              <tr key={`${l.label}|${i}`}>
                <td>{l.label}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(l.areaM2)}</td>
                <td>{l.basis === 'benchmark' ? `measured ${l.brand} stores` : 'generic'}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(l.annualKwh)}</td>
                <td style={{ textAlign: 'right' }}>{formatNumber(l.peakKw, 1)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  )
}
