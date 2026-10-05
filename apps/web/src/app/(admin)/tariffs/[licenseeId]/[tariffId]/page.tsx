import Link from 'next/link'
import { notFound } from 'next/navigation'
import {
  TARIFF_CATEGORY_LABELS, TARIFF_STRUCTURE_LABELS, TOU_LABELS, buildChargeGroups, energyRatesByPeriod, holidayTreatmentFor, labelOf,
} from '@esite/shared'
import { BarChart } from '@/components/charts/BarChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { TouClock } from '@/components/tariffs/TouClock'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadTariffDetail, type TariffDetail } from '@/lib/tariffs/explorer-data'
import { ExplorerChargesTable } from './ExplorerChargesTable'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']

function eligibility(t: TariffDetail['tariff']): string | null {
  const parts = [
    t.voltageBand ? `Voltage ${t.voltageBand}` : null,
    t.phase ? `${t.phase === 'single' ? 'Single' : 'Three'}-phase` : null,
    t.minAmps !== null || t.maxAmps !== null ? `${t.minAmps ?? 0}–${t.maxAmps ?? '∞'} A` : null,
    t.minKva !== null || t.maxKva !== null ? `${t.minKva ?? 0}–${t.maxKva ?? '∞'} kVA` : null,
    t.transmissionZone !== null ? `Transmission zone ${t.transmissionZone}` : null,
  ].filter(Boolean)
  return parts.length ? parts.join(' · ') : null
}

export default async function TariffDetailPage({ params }: { params: Promise<{ licenseeId: string; tariffId: string }> }) {
  const { licenseeId, tariffId } = await params
  if (!UUID.test(licenseeId) || !UUID.test(tariffId)) notFound()
  const supabase = (await createClient()) as unknown as AnyClient
  let d: TariffDetail | null
  try {
    d = await loadTariffDetail(supabase, licenseeId, tariffId)
  } catch {
    return <ErrorState title="Could not load this tariff" description="Reload the page. If it keeps failing, report it to support." />
  }
  if (!d) notFound()
  const { tariff, licensee, year, previous, calendar } = d
  const groups = buildChargeGroups(tariff, d.charges, previous?.tariff ?? null)
  const rates = energyRatesByPeriod(tariff)
  const isTou = rates.rates.length > 0 || tariff.structure === 'tou' || tariff.structure === 'tou_ibt'
  const elig = eligibility(tariff)
  const holidays = calendar ? holidayTreatmentFor({ family: tariff.family, name: tariff.name }, calendar.holidays, calendar.calendar.holidayTreatedAs) : null
  const periods = ['peak', 'standard', 'off_peak'] as const
  const series = (['high', 'low'] as const)
    .map((s, i) => ({ key: s, label: s === 'high' ? 'High demand (winter)' : 'Low demand (summer)', colour: SERIES_COLOURS[i],
      values: periods.map((p) => rates.rates.find((r) => r.season === s && r.period === p)?.cPerKwh ?? 0) }))
    .filter((s) => s.values.some((v) => v > 0))

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <p style={{ fontSize: 13, margin: 0 }}>
        <Link href="/tariffs">Tariffs</Link> / <Link href={`/tariffs/${licensee.id}?fy=${encodeURIComponent(year.financialYear)}`}>{licensee.name} {year.financialYear}</Link> / {tariff.name}
      </p>
      <Card>
        <CardHeader>
          <span className="data-panel-title">{tariff.name}</span>
          <Link href={`/tariffs/compare?t=${tariffId}`} style={{ fontSize: 13 }}>Compare with other tariffs</Link>
        </CardHeader>
        <CardBody>
          <p style={{ fontSize: 13, margin: 0 }}>
            {licensee.name} · {year.financialYear} · in force {year.effectiveFrom} to {year.effectiveTo}
            {year.state === 'superseded' ? ' · superseded' : ''}
          </p>
          <p style={{ fontSize: 13, margin: '4px 0 0', color: 'var(--c-text-mid)' }}>
            {labelOf(TARIFF_CATEGORY_LABELS, tariff.category)} · {labelOf(TARIFF_STRUCTURE_LABELS, tariff.structure)}
            {tariff.code ? ` · ${tariff.code}` : ''}{tariff.metering !== 'both' ? ` · ${tariff.metering}` : ''}{elig ? ` · ${elig}` : ''}
          </p>
          {tariff.notes && <p style={{ fontSize: 12, marginBottom: 0 }}>{tariff.notes}</p>}
          <p style={{ fontSize: 12, color: 'var(--c-text-mid)', marginBottom: 0 }}>
            {previous ? `Year-on-year changes compare each charge with ${previous.tariff.name} in ${previous.financialYear}.` : 'No published tariff of this name in the previous year, so no year-on-year change is shown.'}
          </p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader><span className="data-panel-title">Charges</span><span style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>Excluding VAT unless marked otherwise</span></CardHeader>
        <CardBody><ExplorerChargesTable groups={groups} previousFy={previous?.financialYear ?? null} /></CardBody>
      </Card>

      {isTou && (
        <Card>
          <CardHeader><span className="data-panel-title">Time of use</span></CardHeader>
          <CardBody>
            {!calendar
              ? <p style={{ fontSize: 13, margin: 0 }}>No TOU calendar is loaded for {licensee.name}{licensee.kind === 'eskom' ? '' : ' or Eskom'} yet, so the hours cannot be shown.</p>
              : (
                <div style={{ display: 'grid', gap: 20 }}>
                  <p style={{ fontSize: 12, margin: 0, color: 'var(--c-text-mid)' }}>
                    {calendar.fromEskomFallback
                      ? `${licensee.name} publishes seasons but not hours, so Eskom's hours are shown (assumed equal to Eskom).`
                      : 'Hours as published by the licensee.'}{' '}
                    High-demand months: {calendar.calendar.highSeasonMonths.map((m) => MONTHS[m - 1]).join(', ')}.
                  </p>
                  <section aria-label="Period by hour">
                    <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Period by hour</h3>
                    <TouCalendarDiagram calendar={calendar.calendar} />
                  </section>
                  <section aria-label="24-hour clock">
                    <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>24-hour clock</h3>
                    <TouClock calendar={calendar.calendar} />
                  </section>
                  {series.length > 0 && (
                    <section aria-label="Energy rate by period">
                      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Active energy rate by period</h3>
                      <BarChart title="Active energy rate by TOU period" categories={periods.map((p) => TOU_LABELS[p])} series={series} yUnit="c/kWh" />
                      <table style={{ fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
                        <thead><tr><th style={{ textAlign: 'left', paddingRight: 12 }}>Season</th>{periods.map((p) => <th key={p} style={{ textAlign: 'right', paddingRight: 12 }}>{TOU_LABELS[p]}</th>)}</tr></thead>
                        <tbody>{series.map((s) => (
                          <tr key={s.key}><td style={{ paddingRight: 12 }}>{s.label}</td>{s.values.map((v, i) => <td key={i} style={{ textAlign: 'right', paddingRight: 12, fontVariantNumeric: 'tabular-nums' }}>{v ? `${v.toFixed(2)} c/kWh` : '—'}</td>)}</tr>
                        ))}</tbody>
                      </table>
                      {rates.note && <p style={{ fontSize: 12, color: 'var(--c-text-mid)' }}>{rates.note}</p>}
                    </section>
                  )}
                  {holidays && (
                    <section aria-label="Public holidays">
                      <h3 style={{ fontSize: 13, margin: '0 0 6px' }}>Public holidays</h3>
                      <p style={{ fontSize: 12, margin: 0 }}>{holidays.summary}</p>
                      {holidays.rows.length > 0 && (
                        <table style={{ fontSize: 12, borderCollapse: 'collapse', marginTop: 6 }}>
                          <tbody>{holidays.rows.map((h) => (
                            <tr key={h.holidayDate}><td style={{ paddingRight: 12 }}>{h.holidayDate}</td><td style={{ paddingRight: 12 }}>{h.holidayName}</td><td>billed as {h.treatedAs === 'sunday' ? 'Sunday' : h.treatedAs === 'saturday' ? 'Saturday' : 'its weekday'}</td></tr>
                          ))}</tbody>
                        </table>
                      )}
                    </section>
                  )}
                </div>
              )}
          </CardBody>
        </Card>
      )}
    </div>
  )
}
