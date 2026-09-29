'use server'
/**
 * Generate feasibility / technical report (spec §9.2 and the Overview shortcut §2.2).
 * Feasibility = Solar Edit + financials; technical = Solar Edit. The gate runs FIRST.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { rateLimit } from '@/lib/rate-limit'
import { generateSolarReport } from '@/lib/solar/reports/generate'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const MAX_NOTE = 2000

export async function generateSolarReportAction(input: {
  projectId: string
  kind: 'feasibility' | 'technical'
  note: string | null
  options: { includeLayoutSheet: boolean; include8760: boolean }
}): Promise<{ ok: true; reportId: string; version: number; warning: string | null } | { error: string }> {
  if (input.kind !== 'feasibility' && input.kind !== 'technical') return { error: 'Unknown report type.' }
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, input.kind === 'feasibility' ? 'edit_financials' : 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > MAX_NOTE)) {
    return { error: 'The revision note is too long (2000 characters at most).' }
  }
  if (!rateLimit(`solar-report:${user.id}`, 6, 60_000)) return { error: 'Too many reports at once — wait a minute and try again.' }
  const o = input.options ?? { includeLayoutSheet: false, include8760: false }
  const note = input.note?.trim() || null
  const r = await generateSolarReport({
    projectId: input.projectId, kind: input.kind, note,
    options: { includeLayoutSheet: o.includeLayoutSheet === true, include8760: o.include8760 === true },
    userId: user.id, user: supabase, svc: createServiceClient() as unknown as AnyClient,
  })
  if (!r.ok) return { error: r.error }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'report_generated', objectRef: { kind: input.kind, version: r.version, reportId: r.reportId } })
  await emitProductEvent({ actorId: user.id, projectId: input.projectId, event: 'solar_report_generated', properties: { kind: input.kind } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, reportId: r.reportId, version: r.version, warning: r.warning }
}
