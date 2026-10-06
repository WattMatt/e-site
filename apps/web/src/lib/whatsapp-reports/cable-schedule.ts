// apps/web/src/lib/whatsapp-reports/cable-schedule.ts
//
// Build the current cable schedule PDF for a named person (WhatsApp sub-project 4).
// There is no session on this path, so the person is gated explicitly, before anything
// is read: getExportPolicy resolves user_effective_project_role(project, user), which is
// NULL for anyone not on the site (00238) — the same policy, and the same cost
// redaction, as the web export routes.
import type { SupabaseClient } from '@supabase/supabase-js'
import { getRevisionExportPayload, exportFilenameStem } from '@/lib/cable-schedule/export-payload'
import { getExportPolicy, redactPayloadCost, checkExportSize } from '@/lib/cable-schedule/export-role'
import { renderRevisionPdf } from '@/lib/cable-schedule/export-pdf'

export type CableScheduleResult =
  | { code: 'ok'; filename: string; bytes: Uint8Array }
  | { code: 'no_access' | 'none' | 'too_large'; message?: string }

/** The revision to send: the latest issued one, else the newest draft. */
export async function currentRevisionId(svc: SupabaseClient, projectId: string): Promise<string | null> {
  const { data, error } = await (svc as any)
    .schema('cable_schedule').from('revisions')
    .select('id, status, issued_at, created_at')
    .eq('project_id', projectId)
  if (error) throw new Error(`revisions: ${error.message}`)
  const rows = (data ?? []) as Array<{ id: string; status: string; issued_at: string | null; created_at: string }>
  if (rows.length === 0) return null
  const issued = rows.filter((r) => r.status === 'ISSUED' && r.issued_at).sort((a, b) => b.issued_at!.localeCompare(a.issued_at!))
  if (issued.length) return issued[0].id
  return [...rows].sort((a, b) => b.created_at.localeCompare(a.created_at))[0].id
}

export async function buildCableSchedulePdfForUser(svc: SupabaseClient, userId: string, projectId: string): Promise<CableScheduleResult> {
  const policy = await getExportPolicy(svc, userId, projectId)
  if (!policy.canExport) return { code: 'no_access', message: policy.reason }

  const revisionId = await currentRevisionId(svc, projectId)
  if (!revisionId) return { code: 'none' }

  const payload = await getRevisionExportPayload(svc as any, projectId, revisionId)
  if (!payload) return { code: 'none' }
  const effective = policy.redactCost ? redactPayloadCost(payload) : payload

  const size = checkExportSize(effective, 'pdf')
  if (!size.ok) return { code: 'too_large', message: size.reason }

  const bytes = await renderRevisionPdf(effective)
  return { code: 'ok', filename: `${exportFilenameStem(effective)}.pdf`, bytes }
}
