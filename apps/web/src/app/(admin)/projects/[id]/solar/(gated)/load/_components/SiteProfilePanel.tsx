'use client'
/**
 * Site profile sub-tab (spec §4.5). Everything shown is derived on the server from the STORED series
 * (siteProfileCharts); this component only draws it. Rand values never appear on the Load tab — the
 * monthly bills (basis S4) are energy (kWh) and billed demand (kVA) only.
 */
import { useState } from 'react'
import { MONTH_NAMES, type BillsForm, type LoadSettingsField, type LoadSettingsForm } from '@esite/shared'
import { saveLoadSettingsAction } from '@/actions/solar-load.actions'
import { useSolarDirtyGuard } from '@/lib/solar/dirty-store'
import { useRebuild } from '@/lib/solar/load/use-rebuild'
import { ARCHETYPE_OPTIONS, type ProfileView } from '@/lib/solar/load/view-types'
import { BarChart } from '@/components/charts/BarChart'
import { ChartCard } from '@/components/charts/ChartCard'
import { HeatmapCanvas } from '@/components/charts/HeatmapCanvas'
import { LineChart } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import { formatNumber } from '@/components/charts/scale'
import { RebuildStatus } from './RebuildStatus'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DIVERSITY_REASON = 'Measured data already reflects diversity'

function Kpi({ label, value }: { label: string; value: string }) {
  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 10px', minWidth: 140 }}>
      <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>{label}</div>
      <div style={{ fontSize: 15, fontWeight: 600 }}>{value}</div>
    </div>
  )
}

export function SiteProfilePanel({ projectId, view, canEdit }: { projectId: string; view: ProfileView; canEdit: boolean }) {
  const [form, setForm] = useState<LoadSettingsForm>(view.form)
  const [bills, setBills] = useState<BillsForm>(view.bills)
  const [version, setVersion] = useState(view.studyUpdatedAt)
  const [errors, setErrors] = useState<Partial<Record<LoadSettingsField, string>>>({})
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [dirty, setDirty] = useState(false)
  const { state, run } = useRebuild(projectId)
  useSolarDirtyGuard(dirty)
  const set = <K extends keyof LoadSettingsForm>(k: K, v: LoadSettingsForm[K]) => { setForm((f) => ({ ...f, [k]: v })); setDirty(true) }
  const setMonth = (i: number, patch: Partial<BillsForm['months'][number]>) => {
    const months = [...bills.months]
    months[i] = { ...months[i]!, ...patch }
    setBills({ ...bills, months })
    setDirty(true)
  }
  const sl = view.siteLoad
  const csv = (chart: string) => `/api/projects/${projectId}/solar/site-load/csv?chart=${chart}`
  const dayLabel = (x: number) => sl?.charts.annual[Math.max(0, Math.min(sl.charts.annual.length - 1, Math.round(x)))]?.day ?? ''

  async function saveAndRebuild() {
    if (!dirty) { await run(); return }
    setBusy(true); setError(null); setErrors({})
    const r = await saveLoadSettingsAction({ projectId, form, bills, expectedUpdatedAt: version })
    setBusy(false)
    if ('fieldErrors' in r) { setErrors(r.fieldErrors); return }
    if ('error' in r) { setError(r.error); return }
    setVersion(r.updatedAt)
    setDirty(false)
    await run()
  }

  const fieldError = (k: LoadSettingsField) => errors[k] && <span role="alert" style={{ color: '#dc2626', display: 'block' }}>{errors[k]}</span>

  return (
    <div style={{ display: 'grid', gap: 14 }}>
      <section aria-label="Settings" style={{ display: 'flex', flexWrap: 'wrap', gap: 12, alignItems: 'flex-end', fontSize: 13 }}>
        <label>Reference year<br />
          <select aria-label="Reference year" disabled={!canEdit} value={form.referenceYear} onChange={(e) => set('referenceYear', e.target.value)}>
            <option value="">Latest 12 months of data</option>
            {view.years.map((y) => <option key={y} value={String(y)}>{y}</option>)}
          </select>
          {fieldError('referenceYear')}
        </label>
        <label>Load growth (%/yr)<br />
          <input aria-label="Load growth" disabled={!canEdit} inputMode="decimal" value={form.loadGrowthPct} placeholder="0" onChange={(e) => set('loadGrowthPct', e.target.value)} style={{ width: 70 }} />
          <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-dim)' }}>Cashflow only</span>
          {fieldError('loadGrowthPct')}
        </label>
        <label>Diversity factor<br />
          <input aria-label="Diversity factor" disabled={!canEdit || !view.diversityApplies} inputMode="decimal" value={form.diversityFactor} placeholder="1.0" onChange={(e) => set('diversityFactor', e.target.value)} style={{ width: 70 }} />
          {!view.diversityApplies && <span style={{ display: 'block', fontSize: 11, color: 'var(--c-text-dim)' }}>{DIVERSITY_REASON}</span>}
          {fieldError('diversityFactor')}
        </label>
        {canEdit && (
          <button type="button" disabled={busy || state.running} onClick={saveAndRebuild}>
            {busy ? 'Saving…' : dirty ? 'Save and rebuild' : 'Rebuild site profile'}
          </button>
        )}
      </section>

      {form.loadBasis === 'S4' && (
        <section aria-label="Monthly bills" style={{ fontSize: 13 }}>
          <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Monthly bills (basis S4)</h3>
          <label>Daily shape{' '}
            <select aria-label="Bills shape" disabled={!canEdit} value={bills.archetype} onChange={(e) => { setBills({ ...bills, archetype: e.target.value as BillsForm['archetype'] }); setDirty(true) }}>
              {ARCHETYPE_OPTIONS.map((a) => <option key={a.value} value={a.value}>{a.label}</option>)}
            </select>
          </label>{' '}
          <label>Power factor <input aria-label="Power factor" disabled={!canEdit} inputMode="decimal" value={bills.powerFactor} onChange={(e) => { setBills({ ...bills, powerFactor: e.target.value }); setDirty(true) }} style={{ width: 60 }} /></label>
          <table style={{ fontSize: 12, marginTop: 6 }}>
            <thead><tr><th align="left">Month</th><th>Energy (kWh)</th><th>Billed demand (kVA, optional)</th></tr></thead>
            <tbody>{bills.months.map((m, i) => (
              <tr key={i}><td>{MONTH_NAMES[i]}</td>
                <td><input aria-label={`${MONTH_NAMES[i]} kWh`} disabled={!canEdit} inputMode="decimal" value={m.kwh} onChange={(e) => setMonth(i, { kwh: e.target.value })} /></td>
                <td><input aria-label={`${MONTH_NAMES[i]} kVA`} disabled={!canEdit} inputMode="decimal" value={m.kva} onChange={(e) => setMonth(i, { kva: e.target.value })} /></td>
              </tr>
            ))}</tbody>
          </table>
          {errors.bills && <p role="alert" style={{ color: '#dc2626' }}>{errors.bills}</p>}
        </section>
      )}

      {error && <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>}
      <RebuildStatus state={state} />

      {!sl ? (
        <p style={{ fontSize: 13 }}>No site profile yet. Choose the load basis above{canEdit ? ' and press Rebuild site profile' : ' — someone with edit access builds it'}.</p>
      ) : (
        <>
          {sl.stale && (
            <p role="status" style={{ background: 'var(--c-amber-dim)', border: '1px solid var(--c-amber-mid)', borderRadius: 6, padding: '6px 10px', fontSize: 13, margin: 0 }}>
              Inputs changed since this profile was built ({new Date(sl.builtAt).toLocaleString('en-ZA')}).{canEdit ? ' Rebuild to bring it up to date.' : ''}
            </p>
          )}
          <section aria-label="Key figures" style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
            <Kpi label="Annual energy" value={`${formatNumber(sl.charts.kpis.annualKwh)} kWh`} />
            <Kpi label={sl.coverage.peakSource === 'interval' ? 'Peak (interval max)' : 'Peak (hourly)'} value={`${(sl.coverage.peakSource === 'interval' ? sl.coverage.peakKw : sl.charts.kpis.peakKw).toFixed(1)} kW`} />
            <Kpi label="Load factor" value={`${(sl.charts.kpis.loadFactor * 100).toFixed(0)} %`} />
            <Kpi label="Day / night (06:00–18:00)" value={`${sl.charts.kpis.dayPct.toFixed(0)} % / ${(100 - sl.charts.kpis.dayPct).toFixed(0)} %`} />
            <Kpi label="TOU split" value="Pin a tariff on the Tariff tab to see the TOU split" />
            {sl.designMdKw !== null && <Kpi label="Design max demand (synthesised)" value={`${sl.designMdKw.toFixed(1)} kW`} />}
            <Kpi label="Basis · year" value={`${sl.basis} · ${sl.referenceYear}`} />
          </section>

          <ChartCard title="Annual (8,760 hours)" pngName={`site-load-annual-${sl.referenceYear}.png`} csvHref={csv('annual')}>
            <LineChart title="Annual load, daily band" yUnit="kW" xFormat={dayLabel} series={[{
              key: 'mean', label: 'Daily mean (min–max band)', colour: SERIES_COLOURS[0],
              points: sl.charts.annual.map((d, i) => ({ x: i, y: d.mean })), band: sl.charts.annual.map((d, i) => ({ x: i, lo: d.min, hi: d.max })),
            }]} />
          </ChartCard>
          <ChartCard title="Average day by month" pngName={`site-load-average-day-${sl.referenceYear}.png`} csvHref={csv('avgday')}>
            <HeatmapCanvas title="Average day by month (12 × 24)" rows={SHORT} cells={sl.charts.avgDayByMonth} unit="kW" cellH={18} />
          </ChartCard>
          <ChartCard title="Weekday / Saturday / Sunday" pngName={`site-load-day-types-${sl.referenceYear}.png`} csvHref={csv('daytype')}>
            <LineChart title="Average day by day type" yUnit="kW" xFormat={(x) => `${String(Math.round(x)).padStart(2, '0')}:00`} series={[
              { key: 'wd', label: 'Weekday', colour: SERIES_COLOURS[0], points: sl.charts.dayTypeProfiles.weekday.map((y, x) => ({ x, y })) },
              { key: 'sa', label: 'Saturday', colour: SERIES_COLOURS[1], points: sl.charts.dayTypeProfiles.saturday.map((y, x) => ({ x, y })) },
              { key: 'su', label: 'Sunday & public holiday', colour: SERIES_COLOURS[2], points: sl.charts.dayTypeProfiles.sunday.map((y, x) => ({ x, y })) },
            ]} />
          </ChartCard>
          <ChartCard title="Monthly energy" pngName={`site-load-monthly-${sl.referenceYear}.png`} csvHref={csv('monthly')}>
            <BarChart title="Monthly energy" yUnit="kWh" categories={SHORT} series={[{ key: 'e', label: 'Energy', colour: SERIES_COLOURS[0], values: sl.charts.monthlyKwh }]} />
          </ChartCard>
          <ChartCard title="Load duration curve" pngName={`site-load-duration-${sl.referenceYear}.png`} csvHref={csv('ldc')}>
            <LineChart title="Load duration curve" yUnit="kW" xFormat={(x) => `${Math.round(x)} %`} series={[{ key: 'ldc', label: 'Share of hours at or above', colour: SERIES_COLOURS[3], points: sl.charts.ldc.map((p) => ({ x: p.pct, y: p.kw })) }]} />
          </ChartCard>

          {sl.bulkRecon.length > 0 && (
            <section aria-label="Reconciliation" style={{ border: '1px solid var(--c-border)', borderRadius: 8, padding: 12 }}>
              <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Reconciliation — Σ metered tenants vs bulk (flag beyond ±10 %)</h3>
              {sl.bulkRecon.map((b) => (
                <table key={b.meterId} style={{ fontSize: 12, width: '100%', marginBottom: 8 }}>
                  <caption style={{ textAlign: 'left' }}>{b.label}</caption>
                  <thead><tr><th align="left">Month</th><th align="right">Bulk (kWh)</th><th align="right">Σ tenants (kWh)</th><th align="right">Tenants / bulk</th></tr></thead>
                  <tbody>{b.months.map((m) => (
                    <tr key={m.month} style={{ color: m.flagged ? '#b45309' : undefined }}>
                      <td>{MONTH_NAMES[m.month - 1]}</td><td align="right">{formatNumber(m.bulkKwh)}</td><td align="right">{formatNumber(m.tenantsKwh)}</td>
                      <td align="right">{m.ratio === null ? '—' : `${Math.round(m.ratio * 100)} %`}</td>
                    </tr>
                  ))}</tbody>
                </table>
              ))}
            </section>
          )}
        </>
      )}
    </div>
  )
}
