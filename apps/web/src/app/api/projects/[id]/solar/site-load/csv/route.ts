// apps/web/src/app/api/projects/[id]/solar/site-load/csv/route.ts
/** GET …/site-load/csv?chart=annual|monthly|avgday|daytype|ldc — each Site-profile chart's data at full resolution. Gate: Solar View. */
import { NextResponse } from 'next/server'
import type { SupabaseClient } from '@supabase/supabase-js'
import { seriesCsvRows, siteProfileCharts } from '@esite/shared/solar-load'
import { MONTH_NAMES } from '@esite/shared'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { toCsvText, UUID_RE } from '@/lib/solar/load/meter-access'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export const runtime = 'nodejs'
const CHARTS = ['annual', 'monthly', 'avgday', 'daytype', 'ldc'] as const
type Chart = (typeof CHARTS)[number]
const f3 = (n: number) => n.toFixed(3)

export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id: projectId } = await params
  if (!UUID_RE.test(projectId)) return NextResponse.json({ error: 'invalid project id' }, { status: 400 })
  const chart = new URL(req.url).searchParams.get('chart') as Chart | null
  if (!chart || !CHARTS.includes(chart)) return NextResponse.json({ error: 'unknown chart' }, { status: 400 })
  // solar.site_load is not in the generated types yet (types.ts regen outstanding).
  const supabase = (await createClient()) as unknown as AnyClient
  const gate = await requireSolarLevelAPI(supabase, projectId, 'view')
  if (!gate.ok) return gate.response
  const { data: study } = await supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  const studyId = (study as { id?: string } | null)?.id
  const { data: sl } = studyId
    ? await supabase.schema('solar').from('site_load').select('series, reference_year, built_at').eq('study_id', studyId).order('built_at', { ascending: false }).limit(1).maybeSingle()
    : { data: null }
  const row = sl as { series: number[]; reference_year: number } | null
  if (!row) return NextResponse.json({ error: 'no site profile yet' }, { status: 404 })
  const year = row.reference_year
  const c = siteProfileCharts(row.series, year)
  let rows: Array<Array<string | number>>
  if (chart === 'annual') rows = seriesCsvRows(row.series, year)
  else if (chart === 'monthly') rows = [['month', 'kWh'], ...c.monthlyKwh.map((v, i) => [MONTH_NAMES[i], f3(v)])]
  else if (chart === 'avgday') rows = [['hour', ...MONTH_NAMES.map((m) => `${m}`)], ...Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, '0')}:00`, ...c.avgDayByMonth.map((m) => f3(m[h]))])]
  else if (chart === 'daytype') rows = [['hour', 'weekday_kW', 'saturday_kW', 'sunday_holiday_kW'], ...Array.from({ length: 24 }, (_, h) => [`${String(h).padStart(2, '0')}:00`, f3(c.dayTypeProfiles.weekday[h]), f3(c.dayTypeProfiles.saturday[h]), f3(c.dayTypeProfiles.sunday[h])])]
  else rows = [['percent_of_hours', 'kW'], ...c.ldc.map((p) => [p.pct, f3(p.kw)])]
  return new Response(toCsvText(rows), {
    status: 200,
    headers: { 'content-type': 'text/csv; charset=utf-8', 'content-disposition': `attachment; filename="site-load-${chart}-${year}.csv"`, 'cache-control': 'no-store' },
  })
}
