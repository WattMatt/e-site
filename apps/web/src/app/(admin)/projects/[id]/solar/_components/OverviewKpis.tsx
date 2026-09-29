'use client'
/**
 * Headline KPIs of the selected case (spec §2.4) — all from its stored run (and stored financials);
 * never recomputed here. Controls per §2.2, hidden above the caller's level: "Change selected case"
 * needs Edit; rand values and "Generate feasibility report" need Edit + financials.
 */
import { useState } from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { BarChart3 } from 'lucide-react'
import type { SolarAccessLevel } from '@esite/shared'
import type { HeadlineKpis } from '@/lib/solar/cases/page-data'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { EmptyState } from '@/components/ui/EmptyState'
import { Button } from '@/components/ui/Button'
import { setSelectedSolarCaseAction } from '@/actions/solar-cases.actions'
import { mwh, num, pct, rand, years } from '@/components/solar/format'

export function OverviewKpis({ projectId, level, kpis, selectable, selectedCaseId, studyUpdatedAt, stale }: {
  projectId: string; level: SolarAccessLevel; kpis: HeadlineKpis | null
  selectable: Array<{ id: string; name: string }>; selectedCaseId: string | null; studyUpdatedAt: string | null; stale: boolean
}) {
  const router = useRouter()
  const canWrite = level === 'edit' || level === 'edit_financials'
  const canMoney = level === 'edit_financials'
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const e = kpis?.energy
  const noRuns = selectable.length === 0
  const m = canMoney ? kpis?.money ?? null : null
  const items: Array<[string, string]> = e ? [
    ['PV size', `${num(e.dcKwp)} kWp / ${num(e.acKw)} kW`],
    ['Battery', e.batteryKwh === null ? 'None' : `${num(e.batteryKwh)} kWh / ${num(e.batteryKw ?? 0)} kW`],
    ['Year-1 PV yield', `${mwh(e.annualAcKwh)} (${num(e.specificYieldKwhPerKwp, 0)} kWh/kWp)`],
    ['Self-consumption', pct(e.selfConsumption)],
    ['Solar fraction of load', pct(e.solarFraction)],
    ['Export', mwh(e.exportKwh)],
    ...(m ? [
      ['Year-1 bill before → after (excl. VAT)', `${rand(m.billBeforeZar)} → ${rand(m.billAfterZar)}`],
      ['Year-1 bill saving', rand(m.savingZar)],
      ['Simple payback', years(m.simplePaybackYears)],
      ['IRR', m.irr === null ? 'n/a' : pct(m.irr)],
      ['NPV', rand(m.npvZar)],
      ['LCOE', m.lcoeZarPerKwh === null ? 'n/a' : `R ${num(m.lcoeZarPerKwh, 2)}/kWh`],
    ] as Array<[string, string]> : []),
  ] : []
  return (
    <Card>
      <CardHeader><span className="data-panel-title">{`Headline results${kpis ? ` — ${kpis.caseName}` : ''}`}</span></CardHeader>
      <CardBody>
        {!kpis && !noRuns
          // Runs exist but nothing is selected: the fix is choosing, not running.
          ? <EmptyState icon={BarChart3} dense title="Choose the selected case — reports and proposals use it."
              action={canWrite ? <span>Use Change selected case below.</span> : <Link href={`/projects/${projectId}/solar/yield`}>Open Yield & Scenarios</Link>} />
          : !kpis
          ? <EmptyState icon={BarChart3} dense title="No case has been run yet — start at Site & Supply." action={<Link href={`/projects/${projectId}/solar/site`}>Go to Site & Supply</Link>} />
          : <dl style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10, margin: 0 }}>
              {items.map(([k, v]) => <div key={k}><dt style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>{k}</dt><dd style={{ margin: 0, fontWeight: 600 }}>{v}</dd></div>)}
            </dl>}
        {canMoney && kpis && !m && <p style={{ fontSize: 12 }}>Run financials for this case to see rand values.</p>}
        <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', gap: 12, marginTop: 12 }}>
          {kpis && <Link href={`/projects/${projectId}/solar/yield?case=${kpis.caseId}`}>Open case</Link>}
          {canWrite && (
            <>
              <label htmlFor="solar-selected-case" style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Change selected case</label>
              <select id="solar-selected-case" disabled={busy || noRuns || !studyUpdatedAt} value={selectedCaseId ?? ''}
                onChange={async (ev) => {
                  const next = ev.target.value
                  if (!next || !studyUpdatedAt) return
                  setError(null); setBusy(true)
                  const r = await setSelectedSolarCaseAction({ projectId, caseId: next, expectedUpdatedAt: studyUpdatedAt })
                  setBusy(false)
                  if ('ok' in r) router.refresh(); else setError(r.error)
                }}>
                {noRuns
                  ? <option value="">No completed runs</option>
                  : <>{!selectedCaseId && <option value="">Choose…</option>}{selectable.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</>}
              </select>
              {noRuns && <span style={{ fontSize: 12, color: 'var(--c-text-dim)' }}>Run a case on Yield & Scenarios first</span>}
            </>
          )}
          {canMoney && (
            <Button type="button" size="sm" variant="secondary" disabled title={stale ? 'The selected case is stale — re-run it first' : kpis ? 'Available with Reports & Proposal' : 'Available once a case has been run'}>
              Generate feasibility report
            </Button>
          )}
          {error && <span role="alert">{error}</span>}
        </div>
      </CardBody>
    </Card>
  )
}
