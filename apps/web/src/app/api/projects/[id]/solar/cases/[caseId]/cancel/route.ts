/**
 * POST /api/projects/[id]/solar/cases/[caseId]/cancel — spec §7.2 Cancel (while running). Case-level:
 * at most one run per case can be running (00216 case_runs_one_running). Gate: Solar Edit.
 * Service client: only it may UPDATE a run, and the freeze trigger allows only running → terminal.
 */
import { NextResponse } from 'next/server'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevelAPI } from '@/lib/solar/api-gate'
import { recordSolarAudit } from '@/lib/solar/audit'

export const runtime = 'nodejs'
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type SchemaClient = { schema: (s: string) => { from: (t: string) => any } }

export async function POST(_req: Request, { params }: { params: Promise<{ id: string; caseId: string }> }) {
  const { id, caseId } = await params
  if (!UUID.test(id) || !UUID.test(caseId)) return NextResponse.json({ error: 'invalid id' }, { status: 400 })
  const gate = await requireSolarLevelAPI((await createClient()) as never, id, 'edit')
  if (!gate.ok) return gate.response
  const svc = createServiceClient() as unknown as SchemaClient
  const { data, error } = await svc.schema('solar').from('case_runs').update({ status: 'cancelled' })
    .eq('case_id', caseId).eq('project_id', id).eq('status', 'running').select('id')
  if (error) {
    console.error('[solar-run] cancel failed', { projectId: id, caseId, code: error.code })
    return NextResponse.json({ error: 'The run could not be cancelled — try again.' }, { status: 500 })
  }
  if (!Array.isArray(data) || data.length === 0) return NextResponse.json({ error: 'This run has already finished.' }, { status: 409 })
  const runId = data[0].id as string
  await recordSolarAudit({ projectId: id, actorId: gate.userId, verb: 'case_run_cancelled', objectRef: { caseId, runId } })
  return NextResponse.json({ status: 'cancelled', runId })
}
