'use server'
/** Financials tab actions (functional spec §8). Edit + financials only. case_financials is written through the caller's session; the run's stored results (case_run_financials) are service-written after this gate. */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings } from '@esite/shared'
import { applyRateCard, importLayoutBom, parseCaseConfig, parseFinanceConfig, type CaseFinanceConfig } from '@esite/shared/solar-cases'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { executeFinancialsRun } from '@/lib/solar/cases/financials'
import { loadLayoutDesign } from '@/lib/solar/cases/layout-design'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

export async function saveSolarFinancialsAction(input: { projectId: string; caseId: string; config: unknown; expectedUpdatedAt: string | null }): Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase, userId } = await session(input.projectId)
  const parsed = parseFinanceConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const t = () => supabase.schema('solar').from('case_financials')
  const res = input.expectedUpdatedAt === null
    ? await t().insert({ case_id: input.caseId, config: parsed.fin, config_version: parsed.fin.version }).select('updated_at')
    : await t().update({ config: parsed.fin, config_version: parsed.fin.version }).eq('case_id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  // 23505 on the first save: someone else saved this case's financials first.
  if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : humanSolarError(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'financials_saved', objectRef: { caseId: input.caseId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: res.data[0]!.updated_at as string }
}

/** Fills rate-card lines into the given (unsaved) config; the user reviews and presses Save. */
export async function applySolarRateCardAction(input: { projectId: string; caseId: string; config: unknown }): Promise<{ ok: true; config: CaseFinanceConfig } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase } = await session(input.projectId)
  const parsed = parseFinanceConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const { data: c } = await supabase.schema('solar').from('cases').select('config, organisation_id').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  const cfg = parseCaseConfig((c as Row | null)?.config)
  if (!c || !cfg.ok) return { error: 'Case not found.' }
  // org_settings is owner/admin-only by RLS; an Edit + financials user still needs the org's rate card.
  const { data: os } = await (createServiceClient() as unknown as AnyClient).schema('solar').from('org_settings').select('settings').eq('organisation_id', (c as Row).organisation_id as string).maybeSingle()
  const settings = readSolarOrgSettings((os as Row | null)?.settings ?? null)
  const b = cfg.config.battery
  const r = applyRateCard(parsed.fin, settings, { dcKwp: cfg.config.pv.dcKwp, acKw: cfg.config.pv.acKw, batteryKwh: b.enabled ? b.usableKwh : 0 })
  if (!r.ok) return { error: `Set these on Settings → Solar → Rate card first: ${r.missing.join(', ')}.` }
  return { ok: true, config: r.fin }
}

/**
 * "Import BOM from layout" (spec §8): fills the case's layout BOM into the given (unsaved) config as
 * capex lines (source 'layout_bom', quantities only — rates are the user's). The BOM is computed
 * server-side from the layout's own objects; the layout is the one the CASE is linked to (00219 FK).
 */
export async function importLayoutBomAction(input: { projectId: string; caseId: string; config: unknown }): Promise<{ ok: true; config: CaseFinanceConfig } | { error: string } | { fieldErrors: Record<string, string> }> {
  const { supabase } = await session(input.projectId)
  const parsed = parseFinanceConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const { data: c } = await supabase.schema('solar').from('cases').select('pv_source, layout_id').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  const row = c as { pv_source?: string; layout_id?: string | null } | null
  if (!row) return { error: 'Case not found.' }
  if (row.pv_source !== 'layout' || !row.layout_id) return { error: 'This case is not built from a layout — choose From layout on Yield & Scenarios first.' }
  const design = await loadLayoutDesign(supabase, input.projectId, row.layout_id)
  if (!design) return { error: 'The layout could not be read — reload.' }
  if (design.bom.length === 0) return { error: 'The layout has nothing placed yet — its bill of materials is empty.' }
  return { ok: true, config: importLayoutBom(parsed.fin, design.bom) }
}

export async function runSolarFinancialsAction(input: { projectId: string; caseId: string }): Promise<{ ok: true; id: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  // The gate above (edit_financials) is what authorises the SERVICE insert inside executeFinancialsRun.
  const out = await executeFinancialsRun({ user: supabase, svc: createServiceClient() as unknown as AnyClient, projectId: input.projectId, caseId: input.caseId, userId })
  if (!out.ok) return { error: out.error }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'financials_run', objectRef: { caseId: input.caseId, financialsId: out.id } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_financials_run' })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id: out.id }
}
