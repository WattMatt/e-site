'use client'
/** Meter drawer → Chart (spec §4.3): zoomable, full resolution when zoomed in, gaps shaded, channel toggle. Data comes from the series route. */
import { useEffect, useState } from 'react'
import { LineChart } from '@/components/charts/LineChart'
import { SERIES_COLOURS } from '@/components/charts/palette'

export interface SeriesBody {
  channel: { id: string; unit: string; label: string }
  channels: Array<{ id: string; label: string; unit: string }>
  intervalMin: number
  extent: { first: number; last: number } | null
  window: { from: number; to: number } | null
  fullResolution: boolean
  buckets: Array<{ t0: number; t1: number; min: number | null; max: number | null; mean: number | null }>
  gaps: Array<{ from: number; to: number }>
}
const DAY = 86_400_000
export const sast = (t: number, long: boolean) => new Date(t + 7_200_000).toISOString().slice(0, long ? 16 : 10).replace('T', ' ')

export function MeterSeriesChart({ projectId, meterId }: { projectId: string; meterId: string }) {
  const [channel, setChannel] = useState<string | null>(null)
  const [range, setRange] = useState<{ from: number; to: number } | null>(null)
  const [body, setBody] = useState<SeriesBody | null>(null)
  const [error, setError] = useState<string | null>(null)
  useEffect(() => {
    const q = new URLSearchParams()
    if (channel) q.set('channel', channel)
    if (range) { q.set('from', new Date(range.from).toISOString()); q.set('to', new Date(range.to).toISOString()) }
    let cancelled = false
    fetch(`/api/projects/${projectId}/solar/meters/${meterId}/series?${q.toString()}`)
      .then(async (r) => { if (!r.ok) throw new Error(); return r.json() as Promise<SeriesBody> })
      .then((b) => { if (!cancelled) { setBody(b); setError(null) } })
      .catch(() => { if (!cancelled) setError('The chart could not be loaded — try again.') })
    return () => { cancelled = true }
  }, [projectId, meterId, channel, range])

  if (error) return <p role="alert" style={{ color: '#dc2626', fontSize: 13 }}>{error}</p>
  if (!body) return <p style={{ fontSize: 13 }}>Loading chart…</p>
  if (!body.extent) return <p style={{ fontSize: 13 }}>This channel has no readings.</p>
  const span = body.window ? body.window.to - body.window.from : 0
  const long = span <= 14 * DAY
  const x = (b: SeriesBody['buckets'][number]) => (b.t0 + b.t1) / 2
  const presets: Array<[string, number | null]> = [['All', null], ['Year', 365 * DAY], ['Month', 31 * DAY], ['Week', 7 * DAY]]
  return (
    <div>
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, alignItems: 'center', fontSize: 12, marginBottom: 6 }}>
        {presets.map(([label, d]) => (
          <button key={label} type="button" onClick={() => setRange(d === null ? { from: body.extent!.first - 1, to: body.extent!.last } : { from: body.extent!.last - d, to: body.extent!.last })}>{label}</button>
        ))}
        <label style={{ marginLeft: 'auto' }}>Channel{' '}
          <select value={channel ?? body.channel.id} onChange={(e) => setChannel(e.target.value)}>
            {body.channels.map((c) => <option key={c.id} value={c.id}>{c.label}</option>)}
          </select>
        </label>
      </div>
      <LineChart
        title={`${body.channel.label} readings`}
        yUnit={body.channel.unit}
        xFormat={(t) => sast(t, long)}
        gaps={body.gaps}
        onSelectRange={(from, to) => setRange({ from, to })}
        series={[{
          key: 'v', label: body.fullResolution ? `${body.channel.label} (every reading)` : `${body.channel.label} (mean, min–max band)`, colour: SERIES_COLOURS[0],
          points: body.buckets.map((b) => ({ x: x(b), y: b.mean })),
          band: body.fullResolution ? undefined : body.buckets.map((b) => ({ x: x(b), lo: b.min, hi: b.max })),
        }]}
      />
      <p style={{ fontSize: 11, color: 'var(--c-text-dim)', margin: '4px 0 0' }}>Drag across the chart to zoom. Times are SAST, interval ends. Shaded = no data.</p>
    </div>
  )
}
