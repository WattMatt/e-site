/**
 * Client portal: one status plan as an A3 PDF, inline (spec §7). Gate = requirePortalAccess
 * (client_viewer in the active org AND an active project_members row on THIS project). Plan rows
 * then read through the viewer's own session (00245 SELECT admits client_viewer, so RLS stays the
 * second gate); facts and drawing bytes with the service client, as the portal's other curated reads.
 *
 * app/api/* sits outside the (portal) layout, so this route gates itself.
 *
 * The PDF is never streamed in the response (Vercel's ~4.5 MB limit): it is uploaded to the
 * service-only `reports` bucket at a per-plan path (overwritten each time) and the route answers 303
 * to a 10-minute signed URL, which the portal's link opens inline.
 */
import { type NextRequest, NextResponse } from 'next/server'
import { STATUS_PLAN_PURPOSES } from '@esite/shared/status-plans'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requirePortalAccess } from '@/lib/portal/data'
import { loadStatusPlanRenderInputs, type PlanRenderLoadResult, type StorageLike } from '@/lib/status-plans/plan-render-data'
import { renderStatusPlanPdf, StatusPlanSourceError } from '@/lib/status-plans/render-plan-page'
import { johannesburgDate } from '@/lib/status-plans/load-plan-page'
import { pdfHandoffResponse, statusPlanPortalPath, type HandoffStorage } from '@/lib/reports/pdf-handoff'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

export async function GET(_req: NextRequest, { params }: { params: Promise<{ projectId: string; planId: string }> }) {
  const { projectId, planId } = await params
  const access = await requirePortalAccess(projectId)
  if (!access) return NextResponse.json({ error: 'Not found' }, { status: 404 })

  let load: PlanRenderLoadResult
  let service: ReturnType<typeof createServiceClient>
  try {
    const session = await createClient()
    service = createServiceClient()
    load = await loadStatusPlanRenderInputs(
      { db: session, facts: service, storage: service.storage as unknown as StorageLike },
      { projectId, today: johannesburgDate(new Date()), purposes: STATUS_PLAN_PURPOSES, planIds: [planId], maxPlans: 1 },
    )
  } catch (err) {
    console.error('[portal/status-plans] load error', err)
    return NextResponse.json({ error: 'This plan could not be loaded — try again.' }, { status: 500 })
  }

  const input = load.inputs[0]
  if (!input || !load.organisationId) {
    const reason = load.omitted[0]?.reason
    return reason
      ? NextResponse.json({ error: `This plan cannot be shown: ${reason}.` }, { status: 422 })
      : NextResponse.json({ error: 'Not found' }, { status: 404 })
  }
  let bytes: Uint8Array
  try {
    bytes = await renderStatusPlanPdf(input, 'a3')
  } catch (err) {
    if (err instanceof StatusPlanSourceError) return NextResponse.json({ error: `This plan cannot be shown: ${err.message}.` }, { status: 422 })
    console.error('[portal/status-plans] render error', err)
    return NextResponse.json({ error: 'The plan could not be drawn.' }, { status: 500 })
  }
  return pdfHandoffResponse(service.storage as unknown as HandoffStorage, statusPlanPortalPath(load.organisationId, projectId, planId), bytes, {
    logTag: 'portal/status-plans',
  })
}
