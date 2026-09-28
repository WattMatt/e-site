'use client'
/**
 * Meter comparison (spec §16 parity row: "meter comparison = select 2+ meters → overlay chart").
 * 2–4 meters, ONE overlaid chart. Reuses the drawer's series route (…/meters/[meterId]/series), called once per
 * meter over the SAME window, so each series is already downsampled server-side (≤ 1,200 min/max/mean buckets).
 * Each meter plots its primary channel (the route's default). The route returns that channel's own unit — it is
 * NOT always kW — so only meters sharing one unit are overlaid; any other is named with the reason. A meter whose
 * fetch fails is named and left out; the rest still plot. Read-only energy/power data: View level may use it.
 */
import { useEffect, useMemo, useState } from 'react'
import { LineChart, type LineSeries } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'
import type { MeterView } from '@/lib/solar/load/view-types'
import { sast, type SeriesBody } from './MeterSeriesChart'

const DAY = 86_400_000
const PRESETS: Array<[string, number]> = [['Year', 365 * DAY], ['Month', 31 * DAY], ['Week', 7 * DAY]]

type Outcome = { meter: MeterView; colour: string } & ({ ok: true; body: SeriesBody } | { ok: false; noActivePower?: boolean })

/** Window end = the latest period end among the selected meters (so the most recent data is in view). */
function latestEnd(meters: MeterView[]): number {
  const ends = meters.map((m) => (m.periodEnd ? Date.parse(m.periodEnd) : NaN)).filter(Number.isFinite)
  return ends.length ? Math.max(...ends) : Date.now()
}

export function MeterComparison({ projectId, meters, onClose }: { projectId: string; meters: MeterView[]; onClose: () => void }) {
  const end = useMemo(() => latestEnd(meters), [meters])
  const [range, setRange] = useState<{ from: number; to: number }>(() => ({ from: end - 365 * DAY, to: end }))
  const [outcomes, setOutcomes] = useState<Outcome[] | null>(null)
  const ids = meters.map((m) => m.id).join(',')

  useEffect(() => {
    let cancelled = false
    setOutcomes(null)
    const q = new URLSearchParams({ from: new Date(range.from).toISOString(), to: new Date(range.to).toISOString() }).toString()
    Promise.all(meters.map(async (meter, i): Promise<Outcome> => {
      const colour = SERIES_COLOURS[i % SERIES_COLOURS.length]
      try {
        const r = await fetch(`/api/projects/${projectId}/solar/meters/${meter.id}/series?${q}`)
        if (!r.ok) {
          const e = r.status === 422 ? ((await r.json().catch(() => null)) as { code?: string } | null) : null
          return { meter, colour, ok: false, noActivePower: e?.code === 'no_active_power' }
        }
        return { meter, colour, ok: true, body: (await r.json()) as SeriesBody }
      } catch {
        return { meter, colour, ok: false }
      }
    })).then((o) => { if (!cancelled) setOutcomes(o) })
    return () => { cancelled = true }
    // `ids` stands in for `meters` so a re-render with the same selection does not refetch.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [projectId, ids, range])

  const plan = useMemo(() => {
    if (!outcomes) return null
    const failed = outcomes.filter((o) => !o.ok && !o.noActivePower).map((o) => o.meter.label)
    const noPower = outcomes.filter((o) => !o.ok && o.noActivePower).map((o) => o.meter.label)
    const loaded = outcomes.filter((o): o is Outcome & { ok: true; body: SeriesBody } => o.ok)
    const empty = loaded.filter((o) => !o.body.extent || o.body.buckets.every((b) => b.mean === null)).map((o) => o.meter.label)
    const withData = loaded.filter((o) => !empty.includes(o.meter.label))
    // The overlay unit: the one most of the meters share; a tie goes to the earliest-selected meter's unit.
    const counts = new Map<string, number>()
    for (const o of withData) counts.set(o.body.channel.unit, (counts.get(o.body.channel.unit) ?? 0) + 1)
    let unit: string | null = null
    for (const o of withData) if (unit === null || (counts.get(o.body.channel.unit) ?? 0) > (counts.get(unit) ?? 0)) unit = o.body.channel.unit
    const plotted = withData.filter((o) => o.body.channel.unit === unit)
    const otherUnit = withData.filter((o) => o.body.channel.unit !== unit).map((o) => ({ label: o.meter.label, unit: o.body.channel.unit }))
    const series: LineSeries[] = plotted.map((o) => ({
      key: o.meter.id,
      label: o.body.fullResolution ? o.meter.label : `${o.meter.label} (mean)`,
      colour: o.colour,
      points: o.body.buckets.map((b) => ({ x: (b.t0 + b.t1) / 2, y: b.mean })),
    }))
    return { failed, noPower, empty, otherUnit, unit, series }
  }, [outcomes])

  const long = range.to - range.from <= 14 * DAY
  return (
    <section aria-label="Meter comparison" style={{ border: '1px solid var(--c-border)', borderRadius: 6, padding: 12, margin: '12px 0' }}>
      <header style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
        <h3 style={{ fontSize: 14, margin: 0 }}>Comparing {meters.length} meters</h3>
        {PRESETS.map(([label, d]) => (
          <button key={label} type="button" onClick={() => setRange({ from: end - d, to: end })}>{label}</button>
        ))}
        <button type="button" style={{ marginLeft: 'auto' }} onClick={onClose}>Close comparison</button>
      </header>
      {!plan ? (
        <p style={{ fontSize: 13 }}>Loading {meters.length} meters…</p>
      ) : (
        <>
          {plan.failed.length > 0 && (
            <p role="alert" style={{ color: '#dc2626', fontSize: 13, margin: '0 0 6px' }}>
              {plan.failed.map((l) => `${l} could not be loaded`).join('; ')} — left out of the chart. Try again, or open the meter to check its data.
            </p>
          )}
          {plan.noPower.map((l) => (
            <p key={l} style={{ fontSize: 12, margin: '0 0 4px', color: 'var(--c-text-mid)' }}>{l} has no active-power channel to compare — it is left out.</p>
          ))}
          {plan.otherUnit.map((o) => (
            <p key={o.label} style={{ fontSize: 12, margin: '0 0 4px', color: 'var(--c-text-mid)' }}>
              {o.label} is left out: its readings are in {o.unit}; this overlay is in {plan.unit}. Only meters measured in the same unit can be drawn on one axis.
            </p>
          ))}
          {plan.empty.length > 0 && (
            <p style={{ fontSize: 12, margin: '0 0 4px', color: 'var(--c-text-mid)' }}>No readings in this window: {plan.empty.join(', ')}.</p>
          )}
          {plan.series.length === 0 ? (
            <p style={{ fontSize: 13 }}>Nothing to draw for this window.</p>
          ) : (
            <LineChart
              title={`Meter comparison (${plan.unit})`}
              yUnit={plan.unit ?? ''}
              xFormat={(t) => sast(t, long)}
              onSelectRange={(from, to) => setRange({ from, to })}
              series={plan.series}
            />
          )}
          <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }}>
            Each meter&apos;s primary channel over the same window. Long windows show the mean per bucket; drag across the chart to zoom. Times are SAST, interval ends. Press a legend entry to hide or show a meter.
          </p>
        </>
      )}
    </section>
  )
}
