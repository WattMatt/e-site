'use client'
/** Generate feasibility / technical report (spec §9.2) with revision note and report options. */
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import type { SolarAccessLevel } from '@esite/shared'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { Button } from '@/components/ui/Button'
import { generateSolarReportAction } from '@/actions/solar-reports.actions'

type Selected = { ok: true; caseId: string; caseName: string; runId: string } | { ok: false; stale: boolean; reason: string }

export function ReportGenerator({ projectId, level, selected, feasibility, layoutSheet }: {
  projectId: string; level: SolarAccessLevel; selected: Selected
  feasibility: { ok: boolean; reason: string | null }; layoutSheet: { available: boolean; reason: string | null }
}) {
  const router = useRouter()
  const [note, setNote] = useState('')
  const [sheet, setSheet] = useState(false)
  const [hourly, setHourly] = useState(false)
  const [busy, setBusy] = useState<null | 'feasibility' | 'technical'>(null)
  const [done, setDone] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  if (level === 'view') return null
  const blocked = selected.ok ? null : selected.reason

  async function go(kind: 'feasibility' | 'technical') {
    setBusy(kind); setError(null); setDone(null); setWarning(null)
    const r = await generateSolarReportAction({ projectId, kind, note, options: { includeLayoutSheet: sheet, include8760: hourly } })
    setBusy(null)
    if ('error' in r) { setError(r.error); return }
    setDone(`${kind === 'feasibility' ? 'Feasibility' : 'Technical'} report v${r.version} saved.`)
    setWarning(r.warning)
    setNote('')
    router.refresh()
  }

  return (
    <Card>
      <CardHeader><span className="data-panel-title">{`Generate a report${selected.ok ? ` — ${selected.caseName}` : ''}`}</span></CardHeader>
      <CardBody>
        <p style={{ fontSize: 12, color: 'var(--c-text-dim)', marginTop: 0 }}>Reports are built from the selected case’s stored run — nothing is recomputed.</p>
        <label htmlFor="solar-report-note" style={{ fontSize: 12 }}>Revision note</label>
        <textarea id="solar-report-note" aria-label="Revision note" value={note} maxLength={2000} onChange={(e) => setNote(e.target.value)} rows={2} style={{ width: '100%', display: 'block', marginBottom: 8 }} />
        <div style={{ display: 'grid', gap: 4, fontSize: 13, marginBottom: 12 }}>
          <label><input type="checkbox" aria-label="Include layout sheet" disabled={!layoutSheet.available} checked={sheet} onChange={(e) => setSheet(e.target.checked)} /> Include layout sheet</label>
          {!layoutSheet.available && layoutSheet.reason && <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 22 }}>{layoutSheet.reason}</span>}
          <label><input type="checkbox" aria-label="Include 8760 appendix" checked={hourly} onChange={(e) => setHourly(e.target.checked)} /> Include 8760 appendix (names the run and its hourly CSV export)</label>
          <label><input type="checkbox" aria-label="Include bill check" disabled /> Include bill check</label>
          <span style={{ fontSize: 12, color: 'var(--c-text-dim)', marginLeft: 22 }}>Bill check arrives with the Tariff tab (Phase 2b).</span>
        </div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
          <Button type="button" size="sm" variant="secondary" disabled={Boolean(blocked) || busy !== null} title={blocked ?? undefined} onClick={() => go('technical')}>
            {busy === 'technical' ? 'Generating…' : 'Generate technical report'}
          </Button>
          {level === 'edit_financials' && (
            <Button type="button" size="sm" disabled={Boolean(blocked) || !feasibility.ok || busy !== null} title={blocked ?? feasibility.reason ?? undefined} onClick={() => go('feasibility')}>
              {busy === 'feasibility' ? 'Generating…' : 'Generate feasibility report'}
            </Button>
          )}
        </div>
        {done && <p role="status" style={{ fontSize: 13 }}>{done}</p>}
        {warning && <p style={{ fontSize: 12, color: 'var(--c-warning, #b45309)' }}>{warning}</p>}
        {error && <p role="alert" style={{ fontSize: 13, color: 'var(--c-danger, #b91c1c)' }}>{error}</p>}
      </CardBody>
    </Card>
  )
}
