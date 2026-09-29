/**
 * GET /api/projects/[id]/solar/cases/[caseId]/financials/xlsx — Edit + financials (money); the latest
 * stored financial result, read under money RLS through the caller's session. Nothing is recomputed.
 */
import { NextResponse } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { buildFinancialsWorkbook } from '@/lib/solar/cases/xlsx'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const safe = (s: string) => s.replace(/[^\w .()-]+/g, '_').slice(0, 80)

export async function GET(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = (await createClient()) as any // eslint-disable-line @typescript-eslint/no-explicit-any
  const gate = await requireSolarLevelAPI(supabase, id, 'edit_financials')
  if (!gate.ok) return gate.response
  const [{ data: c }, { data: p }, { data: rows }] = await Promise.all([
    supabase.schema('solar').from('cases').select('id, name').eq('id', caseId).eq('project_id', id).maybeSingle(),
    supabase.schema('projects').from('projects').select('name').eq('id', id).maybeSingle(),
    supabase.schema('solar').from('case_run_financials').select('case_id, created_at, engine_version, tariff_ref, fin_inputs, results')
      .eq('case_id', caseId).order('created_at', { ascending: false }).limit(1),
  ])
  const row = Array.isArray(rows) ? rows[0] : null
  if (!c || !row) return NextResponse.json({ error: 'Run financials first.' }, { status: 404 })
  const buf = await buildFinancialsWorkbook({ projectName: p?.name ?? '', caseName: c.name, row, capexLines: row.fin_inputs?.config?.capex ?? [] })
  return new Response(new Uint8Array(buf), { headers: {
    'content-type': 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'content-disposition': `attachment; filename="${safe(`${p?.name ?? 'Project'} - ${c.name} - financials`)}.xlsx"`,
    'cache-control': 'private, no-store',
  } })
}
