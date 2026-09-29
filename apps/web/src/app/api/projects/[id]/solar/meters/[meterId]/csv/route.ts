// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/csv/route.ts
/**
 * GET …/meters/[meterId]/csv?channel= — normalised readings, full resolution (spec §4.3):
 * `ts_end (SAST), value, unit, quality`. Missing values are empty cells, never 0. Gate: Solar View.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, safeFileName, sastLabel, toCsvText, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'

export const runtime = 'nodejs'
export const maxDuration = 120
const DAY = 86_400_000
const CHUNK = 1400 * DAY

export async function GET(req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const channelId = new URL(req.url).searchParams.get('channel') ?? sm.picked.primary[0]?.id ?? null
  const channel = sm.channels.find((c) => c.id === channelId)
  if (!channel) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const sum = (await channelSummaries(supabase, [channel.id])).get(channel.id)
  const rows: Array<Array<string | number | null>> = [['ts_end (SAST)', 'value', 'unit', 'quality']]
  if (sum?.firstTs != null && sum.lastTs != null) {
    for (let from = sum.firstTs - 1; from < sum.lastTs; from += CHUNK) {
      const part = (await readChannelReadings(supabase, [channel.id], from, Math.min(from + CHUNK, sum.lastTs))).get(channel.id) ?? []
      for (const r of part) rows.push([sastLabel(r.tsEnd), r.value, channel.unit, r.quality])
    }
  }
  return new Response(toCsvText(rows), {
    status: 200,
    headers: {
      'content-type': 'text/csv; charset=utf-8',
      'content-disposition': `attachment; filename="${safeFileName(sm.meter.label)}-normalised.csv"`,
      'cache-control': 'no-store',
    },
  })
}
