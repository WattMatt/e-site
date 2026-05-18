import { NextResponse, type NextRequest } from 'next/server'
import { createClient } from '@/lib/supabase/server'
import { getRevisionExportPayload, exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { renderCsv, type CsvKind, type CsvFilter } from '@/lib/cable-schedule/export-csv'
import {
  getExportPolicy,
  redactPayloadCost,
  checkExportSize,
} from '@/lib/cable-schedule/export-role'

export const runtime = 'nodejs'

const VALID_KINDS: ReadonlyArray<CsvKind> = ['schedule', 'tags', 'cost', 'change_log']

export async function GET(req: NextRequest) {
  const projectId = req.nextUrl.searchParams.get('projectId')
  const revisionId = req.nextUrl.searchParams.get('revisionId')
  const type = req.nextUrl.searchParams.get('type') as CsvKind | null
  if (!projectId || !revisionId || !type || !VALID_KINDS.includes(type)) {
    return NextResponse.json(
      {
        error: `projectId, revisionId, and type=${VALID_KINDS.join('|')} required`,
      },
      { status: 400 },
    )
  }

  const supabase = await createClient()
  const { data: userData } = await supabase.auth.getUser()
  if (!userData?.user) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const payload = await getRevisionExportPayload(supabase, projectId, revisionId)
  if (!payload) {
    return NextResponse.json({ error: 'Revision not found' }, { status: 404 })
  }

  const policy = await getExportPolicy(
    supabase,
    userData.user.id,
    payload.project.organisation_id,
    payload.project.id,
  )
  if (!policy.canExport) {
    return NextResponse.json(
      { error: policy.reason ?? 'Forbidden' },
      { status: 403 },
    )
  }
  const effectivePayload = policy.redactCost ? redactPayloadCost(payload) : payload

  const sizeCheck = checkExportSize(effectivePayload, 'csv')
  if (!sizeCheck.ok) {
    return NextResponse.json({ error: sizeCheck.reason }, { status: sizeCheck.status })
  }

  // T12: optional filter applied at render time. Defensive parsing —
  // query params are untrusted. Filter is applied AFTER the policy +
  // size guards above so a redacted-cost / over-sized payload still
  // short-circuits before any filtering work happens.
  //
  // NOTE: filter / size / conductor query params are ignored for
  // type=change_log (the change_log iterates entity history, not
  // cables — no per-cable filter applies). We accept them silently
  // rather than 400 so stale URL state from a client that just
  // switched the type dropdown still works.
  const filterText = req.nextUrl.searchParams.get('filter')?.trim().toLowerCase() || null
  const rawSize = req.nextUrl.searchParams.get('size')
  const sizeFilter = rawSize
    ? rawSize
        .split(',')
        .map((s) => Number(s.trim()))
        .filter((n) => Number.isFinite(n) && n > 0)
    : null
  const rawCond = req.nextUrl.searchParams.get('conductor')?.toUpperCase() ?? null
  const conductorFilter: 'CU' | 'AL' | null =
    rawCond === 'CU' || rawCond === 'AL' ? rawCond : null

  const filter: CsvFilter = {
    filterText,
    sizeFilter: sizeFilter && sizeFilter.length > 0 ? sizeFilter : null,
    conductorFilter,
  }

  const csv = renderCsv(type, effectivePayload, filter)
  const filename = `${exportFilenameStem(effectivePayload)}-${type}.csv`

  return new Response(csv, {
    status: 200,
    headers: {
      'Content-Type': 'text/csv; charset=utf-8',
      'Content-Disposition': `attachment; filename="${filename}"`,
      'Cache-Control': 'no-store',
    },
  })
}
