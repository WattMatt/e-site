/**
 * GET …/runs/[runId]/export?kind=hourly|monthly|slice&from=&to=
 * Gate: Solar View. The run row is read through the CALLER's session (00215 case_runs_select), so a
 * caller who cannot see the run gets 404; the file is then read with the service client (the bucket
 * has no user policy). Everything served is the stored result — nothing is recomputed.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { getGzipText, RUNS_BUCKET } from '@/lib/solar/cases/storage'
import { decodeHourlyCsv, monthlyCsv, sliceHourlyDays, type CaseRunOutputs } from '@esite/shared/solar-cases'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const csv = (text: string, name: string) => new Response(text, { headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="${name}"`, 'cache-control': 'private, no-store' } })

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaClient = { schema: (s: string) => { from: (t: string) => any } }

export async function GET(req: Request, { params }: { params: Promise<{ id: string; caseId: string; runId: string }> }) {
  const { id, caseId, runId } = await params
  if (![id, caseId, runId].every((v) => UUID.test(v))) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase as never, id, 'view')
  if (!gate.ok) return gate.response
  const { data: run } = await (supabase as unknown as SchemaClient)
    .schema('solar').from('case_runs').select('id, case_id, project_id, status, hourly_path, outputs')
    .eq('id', runId).eq('case_id', caseId).eq('project_id', id).maybeSingle()
  if (!run || run.status !== 'succeeded') return NextResponse.json({ error: 'Run not found.' }, { status: 404 })

  const url = new URL(req.url)
  const kind = url.searchParams.get('kind')
  const stem = `solar-run-${runId.slice(0, 8)}`
  if (kind === 'monthly') return csv(monthlyCsv(run.outputs as CaseRunOutputs), `${stem}-monthly.csv`)
  if (kind !== 'hourly' && kind !== 'slice') return NextResponse.json({ error: 'kind must be hourly, monthly or slice' }, { status: 400 })
  let from = 0, to = 0
  if (kind === 'slice') {
    from = Number(url.searchParams.get('from')); to = Number(url.searchParams.get('to'))
    if (!Number.isInteger(from) || !Number.isInteger(to) || from < 0 || to > 364 || to < from || to - from > 30) {
      return NextResponse.json({ error: 'from/to must be whole days 0–364, at most 31 days' }, { status: 400 })
    }
  }
  let text: string
  try {
    text = await getGzipText(createServiceClient() as never, RUNS_BUCKET, run.hourly_path as string)
  } catch (e) {
    console.error('[solar-export] stored hourly file unreadable', { runId, err: String(e) })
    return NextResponse.json({ error: 'The stored hourly file for this run is missing — re-run the case.' }, { status: 404 })
  }
  if (kind === 'hourly') return csv(text, `${stem}-hourly.csv`)
  return NextResponse.json({ rows: sliceHourlyDays(decodeHourlyCsv(text), from, to) }, { headers: { 'cache-control': 'private, max-age=300' } })
}
