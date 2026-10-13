/**
 * "Export sheet": one sheet of a tenant plan (?sheet=) as a PDF at its own size (spec §8), with the source page
 * embedded as vector. Read-level: any role that can see the project (requireProjectAccess runs as the
 * caller, site-scoped) — the same set that can open the plan page. Plan rows are read through the
 * caller's session; facts and drawing bytes with the service client, only after the gate.
 *
 * ?colour=board exports a floor plan sheet coloured by feeding main board (the feed is read through the caller's session).
 *
 * app/api/* sits outside (admin)/layout.tsx, so this route gates itself.
 *
 * The PDF is never streamed in the response (an A0 sheet can pass Vercel's ~4.5 MB limit): it is
 * uploaded to the service-only `reports` bucket at a per-sheet path (overwritten each export) and the
 * route answers 303 to a 10-minute signed URL that downloads under the sheet's file name.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { STATUS_PLAN_PURPOSES } from '@esite/shared/status-plans'
import type { ColourBy } from '@/lib/status-plans/types'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireProjectAccess } from '@/lib/auth/require-project-access'
import { loadStatusPlanRenderInputs, MAX_STATUS_PLAN_SOURCE_BYTES, type PlanRenderLoadResult, type StorageLike } from '@/lib/status-plans/plan-render-data'
import { renderStatusPlanPdf, StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'
import { isPlanId } from '@/lib/status-plans/plan-id'
import { johannesburgDate } from '@/lib/status-plans/load-plan-page'
import { pdfHandoffResponse, statusPlanSheetPath, type HandoffStorage } from '@/lib/reports/pdf-handoff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

function slug(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, 60) || 'sheet'
}

export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string; planId: string }> }) {
  const { id, planId } = await params
  const supabase = await createClient()
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return NextResponse.json({ error: 'Not authenticated' }, { status: 401 })

  if (!isPlanId(planId)) return NextResponse.json({ error: 'Status plan not found' }, { status: 404 })
  const sheetId = req.nextUrl.searchParams.get('sheet') ?? ''
  if (!isPlanId(sheetId)) return NextResponse.json({ error: 'Sheet not found' }, { status: 404 })

  const colourBy: ColourBy = req.nextUrl.searchParams.get('colour') === 'board' ? 'board' : 'status'

  const access = await requireProjectAccess(supabase, id)
  if (!access.ok) return NextResponse.json({ error: access.error }, { status: access.status })

  const today = johannesburgDate(new Date())
  let load: PlanRenderLoadResult
  let service: ReturnType<typeof createServiceClient>
  try {
    service = createServiceClient()
    load = await loadStatusPlanRenderInputs(
      { db: supabase, facts: service, storage: service.storage as unknown as StorageLike },
      { projectId: id, today, purposes: STATUS_PLAN_PURPOSES, planIds: [planId], sheetIds: [sheetId], maxSheets: 1, maxSourceBytes: MAX_STATUS_PLAN_SOURCE_BYTES, colourBy },
    )
  } catch (err) {
    console.error('[status-plans/sheet] load error', err)
    return NextResponse.json({ error: 'The plan could not be loaded — try again.' }, { status: 500 })
  }
  const input = load.inputs[0]
  if (!input || !load.organisationId) {
    const reason = load.omitted[0]?.reason
    return reason
      ? NextResponse.json({ error: `This sheet could not be exported: ${reason}.` }, { status: 422 })
      : NextResponse.json({ error: 'Sheet not found' }, { status: 404 })
  }

  let bytes: Uint8Array
  try {
    bytes = await renderStatusPlanPdf(input, 'source')
  } catch (err) {
    if (err instanceof StatusPlanSourceError) {
      return NextResponse.json({ error: `This sheet could not be exported: ${err.message}.` }, { status: 422 })
    }
    console.error('[status-plans/sheet] render error', err)
    return NextResponse.json({ error: 'Sheet render failed' }, { status: 500 })
  }

  return pdfHandoffResponse(service.storage as unknown as HandoffStorage, statusPlanSheetPath(load.organisationId, id, input.planId, input.sheetId), bytes, {
    download: `${slug(input.planName)}-${slug(input.sheetLabel)}-${today}.pdf`,
    logTag: 'status-plans/sheet',
  })
}
