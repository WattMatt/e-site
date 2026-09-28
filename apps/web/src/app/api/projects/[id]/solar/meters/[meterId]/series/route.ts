// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/series/route.ts
/**
 * GET …/meters/[meterId]/series?channel=&from=&to= — chart data for the meter drawer (spec §4.3).
 * A window of ≤ 1,200 readings is returned at full resolution; a larger one as min/max/mean buckets
 * (a spike is never averaged away). Gaps are explicit ranges. Gate: Solar View.
 */
import { NextResponse } from 'next/server'
import { gapRanges, minMaxBuckets } from '@esite/shared/solar-load'
import { isUsable } from '@esite/shared/meter-data'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'

export const runtime = 'nodejs'
export const maxDuration = 60
const BUCKETS = 1200
const DAY = 86_400_000
const MAX_WINDOW = 1400 * DAY

export async function GET(req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const url = new URL(req.url)
  const asked = url.searchParams.get('channel')
  // No channel asked for and no active-power primary: a property of the meter, not a missing resource —
  // distinguishable so the comparison can say so (the drawer still reads any !ok as "could not be loaded").
  if (asked === null && !sm.picked.primary[0]) return NextResponse.json({ error: 'no_active_power', code: 'no_active_power' }, { status: 422 })
  const channelId = asked ?? sm.picked.primary[0]?.id ?? null
  const channel = sm.channels.find((c) => c.id === channelId)
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })

  const sum = (await channelSummaries(supabase, [channel.id])).get(channel.id)
  const first = sum?.firstTs ?? null
  const last = sum?.lastTs ?? null
  const channels = sm.channels.map((c) => ({ id: c.id, label: `${c.source_column} (${c.unit}${c.direction !== 'none' ? `, ${c.direction}` : ''})`, unit: c.unit }))
  if (first === null || last === null) {
    return NextResponse.json({ channel: { id: channel.id, unit: channel.unit, label: channel.source_column }, channels, intervalMin: channel.interval_min, extent: null, window: null, fullResolution: true, buckets: [], gaps: [] })
  }
  const qFrom = Date.parse(url.searchParams.get('from') ?? '')
  const qTo = Date.parse(url.searchParams.get('to') ?? '')
  const to = Number.isFinite(qTo) ? Math.min(qTo, last) : last
  let from = Number.isFinite(qFrom) ? Math.max(qFrom, first - 1) : Math.max(first - 1, to - 365 * DAY)
  if (to - from > MAX_WINDOW) from = to - MAX_WINDOW
  const readings = (await readChannelReadings(supabase, [channel.id], from, to)).get(channel.id) ?? []
  const ts = readings.map((r) => r.tsEnd)
  const values = readings.map((r) => (isUsable(r) ? (r.value as number) : null))
  return NextResponse.json({
    channel: { id: channel.id, unit: channel.unit, label: channel.source_column },
    channels,
    intervalMin: channel.interval_min,
    extent: { first, last },
    window: { from, to },
    fullResolution: readings.length <= BUCKETS,
    buckets: minMaxBuckets(ts, values, BUCKETS),
    gaps: gapRanges(ts, values, channel.interval_min),
  })
}
