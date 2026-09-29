import 'server-only'
/**
 * Append one row to solar.audit_events (feeds Overview → Recent activity).
 * Written with the service client AFTER the action's own gate has passed.
 * Since 00218 authenticated users hold NO insert grant or policy on
 * solar.audit_events (an editor could otherwise post a forged activity line
 * through PostgREST), so this is the only writer — pinned by
 * audit-writers.contract.test.ts. It also covers grantors acting before the
 * org subscribes.
 * The bind trigger derives organisation_id from the project; actor_id is kept
 * as passed because auth.uid() is NULL on the service path.
 * Never throws: an audit failure must not fail the user's action.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { createServiceClient } from '@/lib/supabase/server'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export async function recordSolarAudit(a: {
  projectId: string
  actorId: string
  verb: string
  objectRef?: Record<string, unknown>
}): Promise<void> {
  try {
    const svc = createServiceClient() as unknown as AnyClient
    const { error } = await svc.schema('solar').from('audit_events').insert({
      project_id: a.projectId, actor_id: a.actorId, verb: a.verb, object_ref: a.objectRef ?? {},
    })
    if (error) console.error('[solar-audit] insert failed', { verb: a.verb, code: error.code })
  } catch (e) {
    console.error('[solar-audit] threw', { verb: a.verb, err: String(e) })
  }
}
