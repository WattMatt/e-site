// apps/web/src/app/api/projects/[id]/solar/meters/[meterId]/heatmap/route.ts
/** GET …/meters/[meterId]/heatmap — the primary channel's last 365 days as local date × hour (spec §4.3). Gate: Solar View. */
import { NextResponse } from 'next/server'
import { dailyHeatmap } from '@esite/shared/solar-load'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { loadStudyMeter, UUID_RE } from '@/lib/solar/load/meter-access'
import { channelSummaries, readChannelReadings } from '@/lib/solar/load/readings'
import { mergeChannelData } from '@/lib/solar/load/gather'
import { loadErrorMessage } from '@/lib/solar/load/messages'

export const runtime = 'nodejs'
export const maxDuration = 60
const DAY = 86_400_000

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; meterId: string }> }) {
  const { id: projectId, meterId } = await params
  if (!UUID_RE.test(projectId) || !UUID_RE.test(meterId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const sm = await loadStudyMeter(supabase, projectId, meterId)
  if (!sm || sm.picked.primary.length === 0) return NextResponse.json({ error: 'not_found' }, { status: 404 })
  const interval = sm.picked.primary[0].interval_min
  if (interval > 60 || 60 % interval !== 0) return NextResponse.json({ error: 'daily_interval', message: loadErrorMessage('daily_interval') }, { status: 422 })
  const ids = sm.picked.primary.map((c) => c.id)
  const sums = await channelSummaries(supabase, ids)
  const last = Math.max(0, ...[...sums.values()].map((s) => s.lastTs ?? 0))
  if (last === 0) return NextResponse.json({ dates: [], cells: [], unit: 'kW' })
  const merged = mergeChannelData(sm.picked.primary, await readChannelReadings(supabase, ids, last - 365 * DAY, last))
  const h = dailyHeatmap(merged?.readings ?? [], interval)
  return NextResponse.json({ ...h, unit: 'kW' })
}
