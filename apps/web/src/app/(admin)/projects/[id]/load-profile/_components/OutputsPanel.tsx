'use client'
/** Figures, overlays, heat map, load duration curve, monthly energy/MD and the TOU cost. */
import type { LoadProfileView } from '@/lib/load-profile/view-types'
import { BarChart } from '@/components/charts/BarChart'
import { ChartCard } from '@/components/charts/ChartCard'
import { HeatmapCanvas } from '@/components/charts/HeatmapCanvas'
import { LineChart } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import { formatNumber } from '@/components/charts/scale'

const SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const BASIS: Record<string, string> = {
  measured_md: 'measured maximum demand',
  measured_md_plus_synthetic: 'measured maximum demand + synthetic peak',
  design_peak: 'design peak (no interval data)',
}
const MD_LABEL: Record<string, (i: number) => string> = {
  single: (i) => `Maximum demand (${i}-min)`,
  coincident: (i) => `Maximum demand, meters together (${i}-min)`,
  largest_single_meter: (i) => `Maximum demand, largest meter (${i}-min)`,
  sum_of_meter_peaks: () => "Sum of each meter's own peak",
}
const hourLabel = (x: number) => `${String(Math.round(x)).padStart(2, '0')}:00`
const pts = (ys: number[]) => ys.map((y, x) => ({ x, y }))
const rand = (v: number) => `R ${formatNumber(v, 2)}`

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: '6px 10px', minWidth: 150 }}>
      <div style={{ fontSize: 11, color: 'var(--c-text-mid)' }}>{label}</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>{value}</div>
      {sub && <div style={{ fontSize: 11, color: 'var(--c-text-dim)' }}>{sub}</div>}
    </div>
  )
}

export function OutputsPanel({ view }: { view: LoadProfileView }) {
  const a = view.analysis!
  const c = view.cost
  const tou = Boolean(c?.ok && c.touSplit)
  const year = view.settings.referenceYear
  const dates = a.heatmap.dates
  return (
    <div style={{ display: 'grid', gap: 16, marginTop: 16 }}>
      <div className="card" style={{ padding: 16 }}>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Kpi label="Annual energy" value={`${formatNumber(a.kpis.annualKwh)} kWh`} sub={`${formatNumber(a.composition.measuredKwh)} measured · ${formatNumber(a.composition.syntheticKwh)} estimated`} />
          <Kpi label="Peak (hourly average)" value={`${formatNumber(a.kpis.peakKw, 1)} kW`} sub={a.kpis.peakAt} />
          {a.md && <Kpi label={MD_LABEL[a.md.basis](a.md.intervalMin)} value={`${formatNumber(a.md.peak.kva, 1)} kVA`} sub={a.md.basis === 'sum_of_meter_peaks' ? 'never coincident: an upper bound' : `${a.md.peak.at}${a.md.peak.source === 'measured_kva' ? ' · measured kVA' : ` · kW ÷ PF ${view.settings.powerFactor}`}`} />}
          <Kpi label="Load factor" value={`${formatNumber(a.kpis.loadFactor * 100, 1)} %`} />
          <Kpi label="Suggested NMD" value={`${a.nmd.kva} kVA`} sub={`${BASIS[a.nmd.basis]}: ${formatNumber(a.nmd.basisKva, 1)} kVA`} />
          {c?.ok && <Kpi label="Annual cost excl VAT" value={rand(c.annual.totalExclVat)} sub={`${rand(c.annual.totalInclVat)} incl VAT`} />}
        </div>
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', margin: '8px 0 0' }}>
          {a.nmd.rule}. Reference year {year}: every source is aligned to its weekdays and public holidays. The hourly peak is never shown as maximum demand.
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(360px, 1fr))', gap: 16 }}>
        <ChartCard title="Average day by day type" pngName="load-profile-day-types">
          <LineChart title="Average day by day type" yUnit="kW" xFormat={hourLabel} series={[
            { key: 'wd', label: 'Weekday', colour: SERIES_COLOURS[0], points: pts(a.dayTypeProfiles.weekday) },
            { key: 'sat', label: 'Saturday', colour: SERIES_COLOURS[1], points: pts(a.dayTypeProfiles.saturday) },
            { key: 'sun', label: 'Sunday / holiday', colour: SERIES_COLOURS[2], points: pts(a.dayTypeProfiles.sunday) },
          ]} />
        </ChartCard>
        <ChartCard title="Seasonal weekday" pngName="load-profile-seasonal">
          <LineChart title="Seasonal weekday" yUnit="kW" xFormat={hourLabel} series={[
            { key: 'high', label: 'High demand (Jun-Aug)', colour: SERIES_COLOURS[4], points: pts(a.seasonal.high) },
            { key: 'low', label: 'Low demand', colour: SERIES_COLOURS[0], points: pts(a.seasonal.low) },
          ]} />
        </ChartCard>
        <ChartCard title="Daily range over the year" pngName="load-profile-daily">
          <LineChart title="Daily range over the year" yUnit="kW" xFormat={(x) => dates[Math.round(x)] ?? ''} series={[
            { key: 'mean', label: 'Daily mean (band: min to max)', colour: SERIES_COLOURS[0], points: a.annual.map((d, i) => ({ x: i, y: d.mean })), band: a.annual.map((d, i) => ({ x: i, lo: d.min, hi: d.max })) },
          ]} />
        </ChartCard>
        <ChartCard title="Load duration curve" pngName="load-profile-ldc">
          <LineChart title="Load duration curve" yUnit="kW" xFormat={(x) => `${Math.round(x)} %`} series={[
            { key: 'ldc', label: 'kW exceeded for % of hours', colour: SERIES_COLOURS[3], points: a.ldc.map((p) => ({ x: p.pct, y: p.kw })) },
          ]} />
        </ChartCard>
        <ChartCard title="Monthly energy" pngName="load-profile-monthly">
          <BarChart title="Monthly energy" yUnit="kWh" categories={SHORT} series={[{ key: 'kwh', label: 'kWh', colour: SERIES_COLOURS[0], values: a.monthlyKwh }]} />
        </ChartCard>
        <ChartCard title="Heat map (day × hour)" pngName="load-profile-heatmap">
          <HeatmapCanvas title="Heat map (day × hour)" rows={dates} cells={a.heatmap.cells} unit="kW" cellH={2} />
        </ChartCard>
      </div>

      <div className="card" style={{ padding: 16, overflowX: 'auto' }}>
        <h2 style={{ fontSize: 15, margin: '0 0 8px' }}>Monthly energy and demand{c?.ok ? ` · ${c.label}` : ''}</h2>
        <table className="table" style={{ width: '100%', fontSize: 13 }}>
          <thead>
            <tr>
              <th>Month</th><th style={{ textAlign: 'right' }}>kWh</th><th style={{ textAlign: 'right' }}>MD kVA</th><th>MD at</th>
              {c?.ok && <>{tou && <><th style={{ textAlign: 'right' }}>Peak kWh</th><th style={{ textAlign: 'right' }}>Standard kWh</th><th style={{ textAlign: 'right' }}>Off-peak kWh</th></>}<th style={{ textAlign: 'right' }}>Excl VAT</th><th style={{ textAlign: 'right' }}>Incl VAT</th></>}
            </tr>
          </thead>
          <tbody>
            {SHORT.map((m, i) => {
              const md = (a.md?.months ?? []).filter((x) => Number(x.month.slice(5, 7)) === i + 1).sort((p, q) => q.kva - p.kva)[0]
              const cm = c?.ok ? c.months[i] : null
              return (
                <tr key={m}>
                  <td>{m}</td><td style={{ textAlign: 'right' }}>{formatNumber(a.monthlyKwh[i])}</td>
                  <td style={{ textAlign: 'right' }}>{md ? formatNumber(md.kva, 1) : '—'}</td><td>{md?.at ?? ''}</td>
                  {cm && <>{tou && <><td style={{ textAlign: 'right' }}>{formatNumber(cm.tou.peak)}</td><td style={{ textAlign: 'right' }}>{formatNumber(cm.tou.standard)}</td><td style={{ textAlign: 'right' }}>{formatNumber(cm.tou.off_peak)}</td></>}<td style={{ textAlign: 'right' }}>{rand(cm.totalExclVat)}</td><td style={{ textAlign: 'right' }}>{rand(cm.totalInclVat)}</td></>}
                </tr>
              )
            })}
            {c?.ok && (
              <tr style={{ fontWeight: 600 }}>
                <td>Year</td><td style={{ textAlign: 'right' }}>{formatNumber(c.annual.kwh)}</td><td /><td />
                {tou && <><td style={{ textAlign: 'right' }}>{formatNumber(c.annual.tou.peak)}</td><td style={{ textAlign: 'right' }}>{formatNumber(c.annual.tou.standard)}</td><td style={{ textAlign: 'right' }}>{formatNumber(c.annual.tou.off_peak)}</td></>}
                <td style={{ textAlign: 'right' }}>{rand(c.annual.totalExclVat)}</td><td style={{ textAlign: 'right' }}>{rand(c.annual.totalInclVat)}</td>
              </tr>
            )}
          </tbody>
        </table>
        {c?.ok && (
          <ul style={{ fontSize: 12, color: 'var(--c-text-mid)', margin: '8px 0 0', paddingLeft: 18 }}>
            <li>{c.demandNote}</li>
            <li>NMD used for costing: {formatNumber(c.nmdKva, 2)} kVA{c.nmdIsSuggestion ? ' (not confirmed: the highest demand itself is used; enter the notified value under Settings)' : ' (confirmed)'}.</li>
            {c.calendarNote && <li>{c.calendarNote}</li>}
            {c.calendarAssumedEskom && <li>This supplier publishes no time-of-use hours; Eskom&apos;s are assumed.</li>}
            {c.notModelled.map((n, i) => <li key={i}>Not modelled: {n.component} ({n.reason}).</li>)}
          </ul>
        )}
        {c && !c.ok && <p role="alert" style={{ color: 'var(--c-red)', fontSize: 13 }}>{c.error}</p>}
        {!c && <p style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Choose a tariff under Settings to split the energy by time-of-use period and cost it.</p>}
      </div>
    </div>
  )
}
