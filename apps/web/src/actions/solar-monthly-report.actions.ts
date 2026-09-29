'use server'
/**
 * Monthly client report (spec §10). Generate = Edit + financials ("write ∩ cost-view"); commentary
 * = Edit + financials (it sits in the money report). The gate runs FIRST.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { isMonthKey, monthFirstDay, NOTE_SECTIONS, type NoteSection } from '@esite/shared/solar-operations'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { rateLimit } from '@/lib/rate-limit'
import { generateMonthlyReport } from '@/lib/solar/operations/monthly-report'
import { opsError } from '@/lib/solar/operations/errors'
import { installationNotInProject } from '@/lib/solar/operations/own-installation'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

export async function generateSolarMonthlyReportAction(input: { projectId: string; month: string; note: string | null }):
  Promise<{ ok: true; reportId: string; version: number; warning: string | null } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  if (input.note != null && (typeof input.note !== 'string' || input.note.length > 2000)) return { error: 'The revision note is at most 2000 characters.' }
  if (!rateLimit(`solar-monthly:${user.id}`, 6, 60_000)) return { error: 'Too many reports at once — wait a minute and try again.' }
  let r: Awaited<ReturnType<typeof generateMonthlyReport>>
  try {
    r = await generateMonthlyReport({
      projectId: input.projectId, month: input.month, note: input.note?.trim() || null, userId: user.id,
      user: supabase, svc: createServiceClient() as unknown as AnyClient,
    })
  } catch (e) {
    // The aggregation wrappers throw on an RPC error (never "zero generation"); the browser gets a
    // sentence, the log gets the detail (review A5).
    console.error('[solar/monthly-report] generate failed', { projectId: input.projectId, month: input.month, error: e instanceof Error ? e.message : String(e) })
    return { error: 'The month’s generation data could not be read — try again.' }
  }
  if (!r.ok) return { error: r.error }
  await recordSolarAudit({ projectId: input.projectId, actorId: user.id, verb: 'monthly_report_generated', objectRef: { period: input.month, version: r.version, reportId: r.reportId } })
  await emitProductEvent({ actorId: user.id, projectId: input.projectId, event: 'solar_monthly_report_generated', properties: { period: input.month } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, reportId: r.reportId, version: r.version, warning: r.warning }
}

export async function saveMonthlyReportNoteAction(input: {
  projectId: string; installationId: string; month: string; section: NoteSection; body: string; expectedUpdatedAt: string | null
}): Promise<{ ok: true; updatedAt: string } | { error: string }> {
  if (!(NOTE_SECTIONS as readonly string[]).includes(input.section)) return { error: 'Unknown commentary section.' }
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  const body = typeof input.body === 'string' ? input.body.trim() : ''
  if (body.length > 5000) return { error: 'At most 5000 characters.' }
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(input.projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  const t = () => supabase.schema('solar').from('monthly_report_notes')
  const period = monthFirstDay(input.month)
  if (input.expectedUpdatedAt === null) {
    const notHere = await installationNotInProject(supabase, input.projectId, input.installationId)
    if (notHere) return notHere
  }
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ installation_id: input.installationId, period_month: period, section: input.section, body }).select('updated_at')
    : await t().update({ body }).eq('installation_id', input.installationId).eq('project_id', input.projectId)
        .eq('period_month', period).eq('section', input.section)
        .eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}
