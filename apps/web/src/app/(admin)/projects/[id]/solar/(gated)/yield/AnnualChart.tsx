'use client'
/** Annual chart (spec §7.3): 365 stored daily totals, zoomable into the STORED hourly series via the export route. */
import { useState } from 'react'
import type { DailyRow, HourlySliceRow } from '@esite/shared/solar-cases'
import { Button } from '@/components/ui/Button'
import { LineChart } from '@/components/solar/charts/LineChart'

export function AnnualChart({ projectId, caseId, runId, daily }: { projectId: string; caseId: string; runId: string; daily: DailyRow[] }) {
  const [from, setFrom] = useState(0)
  const [span, setSpan] = useState(7)
  const [slice, setSlice] = useState<{ from: number; to: number; rows: HourlySliceRow[] } | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const base = `/api/projects/${projectId}/solar/cases/${caseId}/runs/${runId}/export`
  const load = async () => {
    const to = Math.min(364, from + span - 1)
    setError(null); setBusy(true)
    try {
      const res = await fetch(`${base}?kind=slice&from=${from}&to=${to}`)
      const body = (await res.json().catch(() => ({}))) as { rows?: HourlySliceRow[]; error?: string }
      if (res.ok && Array.isArray(body.rows)) setSlice({ from, to, rows: body.rows })
      else setError(body.error ?? 'The hourly data could not be loaded.')
    } catch {
      setError('The server could not be reached — check your connection and try again.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <div style={{ display: 'grid', gap: 8 }}>
      <LineChart title="Daily energy through the year" unit="kWh/day" xLabels={daily.map((d) => String(d.day + 1))}
        series={[{ label: 'PV', values: daily.map((d) => d.pvKwh) }, { label: 'Load', values: daily.map((d) => d.loadKwh) }, { label: 'Import', values: daily.map((d) => d.importKwh) }, { label: 'Export', values: daily.map((d) => d.exportKwh) }]} />
      <div style={{ display: 'flex', gap: 8, alignItems: 'end', flexWrap: 'wrap' }}>
        <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>From day (0–364)</span>
          <input aria-label="Zoom from day" type="number" min={0} max={364} value={from} onChange={(e) => setFrom(Math.max(0, Math.min(364, Math.trunc(Number(e.target.value) || 0))))} /></label>
        <label style={{ display: 'grid', gap: 2 }}><span style={{ fontSize: 12 }}>Span</span>
          <select aria-label="Zoom span" value={span} onChange={(e) => setSpan(Number(e.target.value))}><option value={1}>1 day</option><option value={7}>7 days</option><option value={31}>31 days</option></select></label>
        <Button type="button" size="sm" variant="secondary" disabled={busy} onClick={load}>Show hourly</Button>
        <a href={`${base}?kind=hourly`}>Download 8760 CSV</a>
      </div>
      {error && <span role="alert" style={{ color: 'var(--c-red, #dc2626)', fontSize: 12 }}>{error}</span>}
      {slice && <LineChart title={`Hourly, days ${slice.from + 1} to ${slice.to + 1}`} unit="kW" xLabels={slice.rows.map((r) => r.startSast.slice(5, 13).replace('T', ' '))}
        series={[{ label: 'PV AC', values: slice.rows.map((r) => r.pvAcKw) }, { label: 'Load', values: slice.rows.map((r) => r.loadKw) }, { label: 'Import', values: slice.rows.map((r) => r.importKw) }, { label: 'Export', values: slice.rows.map((r) => r.exportKw) }, { label: 'Battery SoC (kWh)', values: slice.rows.map((r) => r.socKwh) }]} />}
    </div>
  )
}
