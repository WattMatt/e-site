/**
 * POST /api/projects/[id]/solar/cases/[caseId]/run — functional spec §7.2 Run.
 * Gate: Solar Edit (requireSolarLevelAPI; app/api/* is outside (admin)/layout.tsx). Rate: 10/min/user.
 * The run executes synchronously; a run past maxDuration is closed as timed out by the next run.
 */
import { NextResponse } from 'next/server'
import { revalidatePath } from 'next/cache'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { executeCaseRun } from '@/lib/solar/cases/run-case'
import { rateLimit } from '@/lib/rate-limit'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'

export const runtime = 'nodejs'
export const maxDuration = 60
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const supabase = await createClient()
  const gate = await requireSolarLevelAPI(supabase as never, id, 'edit')
  if (!gate.ok) return gate.response
  if (!rateLimit(`solar-run:${gate.userId}`, 10, 60_000)) return NextResponse.json({ error: 'Too many runs — wait a minute and try again.' }, { status: 429 })

  const out = await executeCaseRun({ user: supabase as never, svc: createServiceClient() as never, projectId: id, caseId, userId: gate.userId })
  if (!out.ok) return NextResponse.json({ error: out.error, ...(out.runId ? { runId: out.runId } : {}) }, { status: out.status })
  await recordSolarAudit({ projectId: id, actorId: gate.userId, verb: 'case_run', objectRef: { caseId, runId: out.runId } })
  await emitProductEvent({ actorId: gate.userId, projectId: id, event: 'solar_case_run' })
  revalidatePath(`/projects/${id}/solar`, 'layout')
  return NextResponse.json({ runId: out.runId, status: out.status })
}
