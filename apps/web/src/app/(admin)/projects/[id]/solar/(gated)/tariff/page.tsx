import Link from 'next/link'
import type { SupabaseClient } from '@supabase/supabase-js'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { loadTariffTab } from '@/lib/solar/tariff/load-tariff-tab'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { TariffPicker } from './TariffPicker'
import { ChargesTable } from './ChargesTable'
import { OverridePanel } from './OverridePanel'
import { ExportRulePanel } from './ExportRulePanel'
import { EscalationTable } from './EscalationTable'
import { BillCheckPanel } from './BillCheckPanel'
import { ReportTariffError } from './ReportTariffError'
import { LinkLicensee } from './LinkLicensee'

export const dynamic = 'force-dynamic'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

const P = { fontSize: 13, margin: 0 } as const
const NOTE = { fontSize: 13, margin: 0, padding: '6px 10px', background: 'var(--c-amber-dim)', borderRadius: 6 } as const
const ASSUMED_ESKOM = "TOU hours assumed equal to Eskom's — confirm against the municipality's by-law"

/**
 * Tariff (spec §5). Edit + financials only: the gate runs BEFORE anything is
 * read (every table below is a money read), and every action re-checks.
 * Client components receive JSON only; they build their own closures over
 * the server actions (the 2026-09-22 rule).
 */
export default async function SolarTariffPage({ params, searchParams }: {
  params: Promise<{ id: string }>
  searchParams: Promise<{ fy?: string }>
}) {
  const { id } = await params
  const { fy } = await searchParams
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(id, 'edit_financials', supabase)
  const d = await loadTariffTab(supabase, id, { fy: fy ?? null, todayIso: new Date().toISOString().slice(0, 10) })

  if (!d.study) {
    return <Card><CardBody><p style={P}><Link href={`/projects/${id}/solar/site`}>Save Site & Supply first</Link></p></CardBody></Card>
  }
  const study = d.study
  const pinned = d.pinned
  const published = Object.fromEntries((pinned?.charges ?? []).map((c) => [c.id, { amount: c.amount, unit: c.unit }]))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Card>
        <CardHeader><span className="data-panel-title">Supply authority</span></CardHeader>
        <CardBody>
          {d.licensee
            ? <p style={P}>{d.licensee.name} <Link href={`/projects/${id}/solar/site`} style={{ fontSize: 12 }}>(change on Site & Supply)</Link></p>
            : <div style={{ display: 'grid', gap: 8 }}>
                <p style={P}><Link href={`/projects/${id}/solar/site`}>Choose the supply authority on Site & Supply</Link></p>
                {study.licenseeName && d.licenseeOptions.length > 0 && (
                  <LinkLicensee projectId={id} updatedAt={study.updatedAt} typedName={study.licenseeName} options={d.licenseeOptions} />
                )}
              </div>}
        </CardBody>
      </Card>

      {d.licensee && (
        <Card>
          <CardHeader><span className="data-panel-title">Tariff</span></CardHeader>
          <CardBody>
            {d.years.length === 0
              ? <p style={P}>No published tariff year for {d.licensee.name} in the library yet. Ask the tariff library maintainers to add it.</p>
              : <TariffPicker projectId={id} years={d.years} selectedYearId={d.selectedYearId} yearNote={d.yearNote} tariffs={d.tariffs}
                  supply={d.supply} pinnedTariffId={study.tariffId}
                  lockedReason={d.override ? 'Revert the project override before choosing another tariff.' : null} updatedAt={study.updatedAt} />}
          </CardBody>
        </Card>
      )}

      {pinned && (
        <>
          <Card>
            <CardHeader>
              <span className="data-panel-title">{pinned.name} · {pinned.financialYear}{pinned.yearState === 'superseded' ? ' (superseded)' : ''}</span>
              <ReportTariffError projectId={id} tariffId={pinned.id} />
            </CardHeader>
            <CardBody>
              {pinned.newerYear && <p style={NOTE}>A newer tariff year ({pinned.newerYear}) is available: choose it above to move this study onto it.</p>}
              {d.override
                ? <div style={{ display: 'grid', gap: 12 }}>
                    <OverridePanel projectId={id} studyUpdatedAt={study.updatedAt} override={d.override} published={published} />
                    <details style={{ fontSize: 13 }}>
                      <summary>Published tariff</summary>
                      <div style={{ marginTop: 8 }}><ChargesTable projectId={id} charges={pinned.charges} /></div>
                    </details>
                  </div>
                : <div style={{ display: 'grid', gap: 12 }}>
                    <ChargesTable projectId={id} charges={pinned.charges} />
                    <OverridePanel projectId={id} studyUpdatedAt={study.updatedAt} override={null} published={published} />
                  </div>}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><span className="data-panel-title">Time-of-use calendar</span></CardHeader>
            <CardBody>
              {!pinned.isTou && <p style={P}>Flat-rate tariff (no time-of-use)</p>}
              {pinned.isTou && d.calendarAssumedEskom && <p style={NOTE}>{ASSUMED_ESKOM}</p>}
              {pinned.isTou && (d.calendar
                ? <TouCalendarDiagram calendar={d.calendar} />
                : <p style={P}>No TOU calendar in the library for this supply authority. Report it as a tariff error.</p>)}
              {pinned.isTou && d.holidays.length > 0 && (
                <details style={{ marginTop: 8, fontSize: 13 }}>
                  <summary>Public holidays this year ({d.holidays.length})</summary>
                  <ul style={{ margin: '4px 0', paddingLeft: 18 }}>{d.holidays.map((h) => <li key={h.date}>{h.date} {h.name}</li>)}</ul>
                </details>
              )}
            </CardBody>
          </Card>

          <Card>
            <CardHeader><span className="data-panel-title">Export / SSEG rule</span></CardHeader>
            <CardBody>
              <ExportRulePanel projectId={id} updatedAt={study.updatedAt} rule={study.exportRule} rates={d.exportRates} sourceNote={d.exportSourceNote}
                linkedExportTariff={pinned.exportTariff} sseg={pinned.sseg} ssegFromLibrary={pinned.ssegFromLibrary} />
            </CardBody>
          </Card>
        </>
      )}

      {/* Before a tariff is pinned the calendar card is absent: say the hours are assumed here. */}
      {d.licensee && !pinned && d.calendarAssumedEskom && d.calendar && (
        <Card><CardBody><p style={NOTE}>{ASSUMED_ESKOM}</p></CardBody></Card>
      )}

      <Card>
        <CardHeader><span className="data-panel-title">Escalation path</span></CardHeader>
        <CardBody><EscalationTable projectId={id} updatedAt={study.updatedAt} rows={d.escalation} /></CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Bill check</span></CardHeader>
        <CardBody><BillCheckPanel projectId={id} isTou={pinned?.isTou ?? false} history={d.billChecks} canRun={Boolean(pinned)} /></CardBody>
      </Card>
    </div>
  )
}
