import Link from 'next/link'
import type { CSSProperties } from 'react'
import { notFound } from 'next/navigation'
import {
  SEASON_LABELS, TARIFF_CATEGORY_LABELS, TARIFF_STRUCTURE_LABELS, TOU_LABELS, buildChargeGroups, displayLicenseeName, energyRangeText, energyRatesByPeriod,
  holidayTreatmentFor, labelOf, signedPct, summariseYoy, tariffHeadline,
} from '@esite/shared'
import { BarChart } from '@/components/charts/BarChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import { TouCalendarDiagram } from '@/components/tariffs/TouCalendarDiagram'
import { TouClock } from '@/components/tariffs/TouClock'
import { Badge } from '@/components/ui/Badge'
import { Card, CardBody, CardHeader } from '@/components/ui/Card'
import { ErrorState } from '@/components/ui/ErrorState'
import { createClient } from '@/lib/supabase/server'
import type { AnyClient } from '@/lib/tariffs/admin-gate'
import { loadTariffDetail, type TariffDetail } from '@/lib/tariffs/explorer-data'
import { Breadcrumb, MUTED, NUM, Stat, YoyChip, autoGrid, formatIsoDate } from '../../_components/explorer-ui'
import { ExplorerChargesTable } from './ExplorerChargesTable'

export const dynamic = 'force-dynamic'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const PERIODS = ['peak', 'standard', 'off_peak'] as const
const TOU_SWATCH: Record<(typeof PERIODS)[number], string> = { peak: 'var(--tou-peak)', standard: 'var(--tou-standard)', off_peak: 'var(--tou-off-peak)' }

/** Who the tariff is for, as separate facts rather than one long sentence. */
function eligibility(t: TariffDetail['tariff']): string[] {
  return [
    t.voltageBand ? `Voltage ${t.voltageBand}` : null,
    t.phase ? `${t.phase === 'single' ? 'Single' : 'Three'}-phase` : null,
    t.minAmps !== null || t.maxAmps !== null ? `${t.minAmps ?? 0}–${t.maxAmps ?? '∞'} A` : null,
    t.minKva !== null || t.maxKva !== null ? `${t.minKva ?? 0}–${t.maxKva ?? '∞'} kVA` : null,
    t.transmissionZone !== null ? `Transmission zone ${t.transmissionZone}` : null,
    t.metering !== 'both' ? `${t.metering[0].toUpperCase()}${t.metering.slice(1)} metering` : null,
  ].filter((s): s is string => s !== null)
}

const H3: CSSProperties = { fontSize: 13, margin: '0 0 8px' }

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
  const name = displayLicenseeName(licensee.name)
  const groups = buildChargeGroups(tariff, d.charges, previous?.tariff ?? null)
  const headline = tariffHeadline(tariff)
  const yoy = summariseYoy(groups)
  const rates = energyRatesByPeriod(tariff)
  const isTou = rates.rates.length > 0 || tariff.structure === 'tou' || tariff.structure === 'tou_ibt'
  const holidays = calendar ? holidayTreatmentFor({ family: tariff.family, name: tariff.name }, calendar.holidays, calendar.calendar.holidayTreatedAs) : null
  const rateAt = (s: 'high' | 'low', p: (typeof PERIODS)[number]) => rates.rates.find((r) => r.season === s && r.period === p)?.cPerKwh ?? null
  const seasons = (['high', 'low'] as const).filter((s) => rates.rates.some((r) => r.season === s))
  // A tariff without seasons yields the same rates for both: one row, "All year".
  const seasonless = seasons.length === 2 && PERIODS.every((p) => rateAt('high', p) === rateAt('low', p))
  const matrix = (seasonless ? (['high'] as const) : seasons).map((s) => ({
    key: s, title: seasonless ? 'All year' : s === 'high' ? 'High demand' : 'Low demand', sub: seasonless ? null : s === 'high' ? 'winter' : 'summer',
    values: PERIODS.map((p) => rateAt(s, p)),
  }))
  // A missing period is null, a real 0 c/kWh rate stays 0: the matrix shows them differently, the chart cannot.
  const series = matrix.map((m, i) => ({ key: m.key, label: seasonless ? 'All year' : SEASON_LABELS[m.key], colour: SERIES_COLOURS[i], values: m.values.map((v) => v ?? 0) }))
  const allRates = rates.rates.map((r) => r.cPerKwh)
  const maxRate = allRates.length ? Math.max(...allRates) : 0
  const minRate = allRates.length ? Math.min(...allRates) : 0

  return (
    <div style={{ display: 'grid', gap: 16 }}>
      <Breadcrumb items={[
        { href: '/tariffs', label: 'Tariffs' },
        { href: `/tariffs/${licensee.id}?fy=${encodeURIComponent(year.financialYear)}`, label: `${name} ${year.financialYear}` },
        { label: tariff.name },
      ]} />

      <Card>
        <CardHeader>
          <div style={{ display: 'flex', flexWrap: 'wrap', alignItems: 'center', justifyContent: 'space-between', gap: 10 }}>
            <span className="data-panel-title" style={{ fontSize: 16 }}>{tariff.name}</span>
            <Link href={`/tariffs/compare?t=${tariffId}`} style={{ fontSize: 13, padding: '5px 12px', borderRadius: 6, border: '1px solid var(--c-amber)', color: 'var(--c-amber)', textDecoration: 'none', whiteSpace: 'nowrap' }}>
              Compare with other tariffs
            </Link>
          </div>
        </CardHeader>
        <CardBody>
          <div style={{ display: 'grid', gap: 14 }}>
            <p style={{ fontSize: 13, margin: 0 }}>
              {name} · {year.financialYear} · in force {formatIsoDate(year.effectiveFrom)} to {formatIsoDate(year.effectiveTo)}
              {year.state === 'superseded' && <> · <Badge variant="warning">Superseded</Badge></>}
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }} aria-label="Who this tariff is for" role="group">
              <Badge variant="info">{labelOf(TARIFF_CATEGORY_LABELS, tariff.category)}</Badge>
              <Badge variant="info">{labelOf(TARIFF_STRUCTURE_LABELS, tariff.structure)}</Badge>
              {tariff.code && !tariff.name.includes(tariff.code) && <Badge variant="default">{tariff.code}</Badge>}
              {eligibility(tariff).map((e) => <Badge key={e} variant="default">{e}</Badge>)}
              {tariff.isLegacy && <Badge variant="ghost">Legacy</Badge>}
            </div>
            {tariff.notes && <p style={{ fontSize: 12, margin: 0 }}>{tariff.notes}</p>}
            <div style={autoGrid(140, 10)} role="group" aria-label="At a glance">
              <Stat label="Energy" value={headline.energy ? energyRangeText(headline.energy) : '—'} sub={headline.energy ? 'active energy, across seasons, periods and blocks' : 'no per-kWh energy charge'} />
              {headline.fixed.map((f) => <Stat key={f.component} label={f.label} value={f.text} />)}
              {headline.capacityOrDemand && <Stat label="Capacity or demand" value="Charged" sub="per kVA, kW or amp: see Charges" />}
              {yoy && previous && (
                <Stat label={`Typical change vs ${previous.financialYear}`}
                  value={yoy.compared ? <YoyChip pct={yoy.medianPct} /> : '—'}
                  sub={yoy.compared
                    ? `typical of ${yoy.compared} charge${yoy.compared === 1 ? '' : 's'}${yoy.minPct !== yoy.maxPct ? `, ${signedPct(yoy.minPct)} to ${signedPct(yoy.maxPct)}` : ''}${yoy.added ? ` · ${yoy.added} new` : ''}`
                    : `${yoy.added} new charge${yoy.added === 1 ? '' : 's'}`} />
              )}
            </div>
            <p style={{ fontSize: 12, ...MUTED, margin: 0 }}>
              {previous ? `Year-on-year changes compare each charge with ${previous.tariff.name} in ${previous.financialYear}.` : 'No published tariff of this name in the previous year, so no year-on-year change is shown.'}
            </p>
          </div>
        </CardBody>
      </Card>

      {series.length > 0 && (
        <Card>
          <CardHeader><span className="data-panel-title">Energy rates</span><span style={{ fontSize: 12, ...MUTED }}>c/kWh, excluding VAT</span></CardHeader>
          <CardBody>
            <div style={{ ...autoGrid(320, 20), alignItems: 'center' }}>
              <section aria-label="Energy rate by season and period" style={{ overflowX: 'auto' }}>
                <table style={{ borderCollapse: 'separate', borderSpacing: 3, width: '100%' }}>
                  <thead><tr>
                    <th style={{ textAlign: 'left', fontSize: 11, ...MUTED, fontWeight: 600 }}>Season</th>
                    {PERIODS.map((p) => (
                      <th key={p} style={{ textAlign: 'right', fontSize: 11, ...MUTED, fontWeight: 600, whiteSpace: 'nowrap' }}>
                        <span aria-hidden style={{ display: 'inline-block', width: 8, height: 8, borderRadius: 2, background: TOU_SWATCH[p], marginRight: 4, border: '1px solid var(--c-border)' }} />{TOU_LABELS[p]}
                      </th>
                    ))}
                  </tr></thead>
                  <tbody>{matrix.map((s) => (
                    <tr key={s.key}>
                      <th scope="row" style={{ textAlign: 'left', fontSize: 12, fontWeight: 500, paddingRight: 4 }}>{s.title}{s.sub && <span style={{ display: 'block', fontSize: 11, ...MUTED, fontWeight: 400 }}>{s.sub}</span>}</th>
                      {s.values.map((v, i) => {
                        const tone = v === maxRate && maxRate !== minRate ? 'var(--c-red-dim)' : v === minRate && maxRate !== minRate ? 'var(--c-green-dim)' : 'var(--c-surface)'
                        return (
                          <td key={i} style={{ textAlign: 'right', padding: '9px 8px', borderRadius: 6, background: v !== null ? tone : 'transparent', border: '1px solid var(--c-border)' }}>
                            <span style={{ ...NUM, fontSize: 15, fontWeight: 600 }}>{v !== null ? v.toFixed(2) : '—'}</span>
                          </td>
                        )
                      })}
                    </tr>
                  ))}</tbody>
                </table>
                <p style={{ fontSize: 11, ...MUTED, margin: '6px 4px 0' }}>
                  Weekday rates. Dearest cell tinted red, cheapest green.{rates.note ? ` ${rates.note}` : ''}
                </p>
              </section>
              <BarChart title="Active energy rate by TOU period" categories={PERIODS.map((p) => TOU_LABELS[p])} series={series} yUnit="c/kWh" height={220} />
            </div>
          </CardBody>
        </Card>
      )}

      <Card>
        <CardHeader><span className="data-panel-title">Charges</span><span style={{ fontSize: 12, ...MUTED }}>Every amount excluding VAT</span></CardHeader>
        <CardBody><ExplorerChargesTable groups={groups} previousFy={previous?.financialYear ?? null} /></CardBody>
      </Card>

      {isTou && (
        <Card>
          <CardHeader><span className="data-panel-title">Time of use</span></CardHeader>
          <CardBody>
            {!calendar
              ? <p style={{ fontSize: 13, margin: 0 }}>No TOU calendar is loaded for {name}{licensee.kind === 'eskom' ? '' : ' or Eskom'} yet, so the hours cannot be shown.</p>
              : (
                <div style={{ display: 'grid', gap: 20 }}>
                  <p style={{ fontSize: 12, margin: 0, ...MUTED }}>
                    {calendar.fromEskomFallback
                      ? `${name} publishes seasons but not hours, so Eskom's hours are shown (assumed equal to Eskom).`
                      : 'Hours as published by the licensee.'}{' '}
                    High-demand months: {calendar.calendar.highSeasonMonths.map((m) => MONTHS[m - 1]).join(', ')}.
                  </p>
                  <section aria-label="Period by hour">
                    <h3 style={H3}>Period by hour</h3>
                    <TouCalendarDiagram calendar={calendar.calendar} />
                  </section>
                  <section aria-label="24-hour clock">
                    <h3 style={H3}>24-hour clock</h3>
                    <TouClock calendar={calendar.calendar} />
                  </section>
                  {holidays && (
                    <section aria-label="Public holidays">
                      <h3 style={H3}>Public holidays</h3>
                      <p style={{ fontSize: 12, margin: 0 }}>{holidays.summary}</p>
                      {holidays.rows.length > 0 && (
                        <ul style={{ listStyle: 'none', padding: 0, margin: '8px 0 0', ...autoGrid(240, 4), fontSize: 12 }}>
                          {holidays.rows.map((h) => (
                            <li key={h.holidayDate} style={{ display: 'flex', justifyContent: 'space-between', gap: 8, padding: '4px 8px', border: '1px solid var(--c-border)', borderRadius: 6 }}>
                              <span><span style={{ ...NUM, ...MUTED, marginRight: 6 }}>{formatIsoDate(h.holidayDate)}</span><span>{h.holidayName}</span></span>
                              <span style={MUTED}>billed as {h.treatedAs === 'sunday' ? 'Sunday' : h.treatedAs === 'saturday' ? 'Saturday' : 'its weekday'}</span>
                            </li>
                          ))}
                        </ul>
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
