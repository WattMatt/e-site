'use server'
/**
 * Tariff tab actions (spec §5). Every action re-checks Edit + financials
 * (requireSolarLevel redirects lower levels) BEFORE reading money or touching
 * the service client, and writes through the caller's session so 00213
 * decides (studies_tariff_guard; money tables' RESTRICTIVE gates; override
 * functions are SECURITY INVOKER). Saves carry expectedUpdatedAt. Audit rows
 * carry ids, never rand amounts (View users read the activity feed).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import {
  BILL_ENGINE_VERSION, BillCheckError, escalationSettingsFrom, readSolarOrgSettings, roundCents, runBillCheck,
  validateBillCheckForm, validateEscalationOverrides, validateExportRuleForm, validateOverrideEdit,
  type BillCheckField, type BillCheckForm, type ChargeComponent, type ExportRuleForm, type OverrideEditForm, type TariffSeason,
} from '@esite/shared'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanSolarTariffError } from '@/lib/solar/tariff/errors'
import { loadEffectiveTariff } from '@/lib/solar/tariff/effective-tariff'
import { isTouTariff } from '@/lib/solar/tariff/rows'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

async function gate(projectId: string): Promise<{ supabase: AnyClient; userId: string } | { error: string }> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit_financials', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}

function refresh(projectId: string): void {
  revalidatePath(`/projects/${projectId}/solar`, 'layout')
}

async function updateStudy(supabase: AnyClient, projectId: string, expectedUpdatedAt: string, patch: Row):
  Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const { data, error } = await supabase.schema('solar').from('studies').update(patch)
    .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: String((data[0] as Row).updated_at ?? '') }
}

// ── Licensee link (when the Site & Supply name matches nothing in the library)
export async function setStudyLicenseeAction(input: { projectId: string; licenseeId: string; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!UUID.test(input.licenseeId)) return { error: 'Choose a supply authority from the library.' }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { licensee_id: input.licenseeId })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_licensee_linked', objectRef: { licenseeId: input.licenseeId } })
  refresh(input.projectId)
  return r
}

// ── Tariff pin ──────────────────────────────────────────────────────────────
export async function selectSolarTariffAction(input: { projectId: string; tariffId: string; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  if (!UUID.test(input.tariffId)) return { error: 'Choose a tariff.' }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { tariff_id: input.tariffId })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_selected', objectRef: { tariffId: input.tariffId } })
  refresh(input.projectId)
  return r
}

// ── Export / SSEG rule ──────────────────────────────────────────────────────
export async function saveSolarExportRuleAction(input: { projectId: string; form: ExportRuleForm; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const solar = g.supabase.schema('solar')
  const { data: s } = await solar.from('studies').select('id, tariff_id, updated_at').eq('project_id', input.projectId).maybeSingle()
  const study = s as Row | null
  if (!study) return { error: 'Save Site & Supply first.' }
  if (String(study.updated_at) !== input.expectedUpdatedAt) return { error: STALE_MESSAGE }
  // The linked method is decided from the pinned tariff, never from the client.
  let hasLinked = false
  if (study.tariff_id) {
    const { data: t } = await g.supabase.schema('tariffs').from('tariff').select('export_tariff_id').eq('id', String(study.tariff_id)).maybeSingle()
    hasLinked = Boolean((t as Row | null)?.export_tariff_id)
  }
  const v = validateExportRuleForm(input.form, hasLinked)
  if ('errors' in v) return { fieldErrors: v.errors }
  const del = await solar.from('study_export_rates').delete().eq('study_id', String(study.id))
  if (del.error) return { error: humanSolarTariffError(del.error) }
  if (v.rates.length > 0) {
    const ins = await solar.from('study_export_rates').insert(v.rates.map((r) => ({
      study_id: String(study.id), season: r.season, tou: r.tou, unit: r.unit, amount_excl_vat: r.amountExclVat, source_note: v.rule.sourceNote,
    })))
    if (ins.error) return { error: humanSolarTariffError(ins.error) }
  }
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { export_rule: v.rule })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'export_rule_saved', objectRef: { method: v.rule.method } })
  refresh(input.projectId)
  return r
}

// ── Escalation path (D-07) ──────────────────────────────────────────────────
export async function saveSolarEscalationAction(input: { projectId: string; form: Record<string, string>; expectedUpdatedAt: string }):
  Promise<{ ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { data: s } = await g.supabase.schema('solar').from('studies').select('organisation_id').eq('project_id', input.projectId).maybeSingle()
  const orgId = (s as Row | null)?.organisation_id
  if (!orgId) return { error: 'Save Site & Supply first.' }
  const { data: os } = await g.supabase.schema('solar').from('org_settings').select('settings').eq('organisation_id', String(orgId)).maybeSingle()
  const years = escalationSettingsFrom(readSolarOrgSettings((os as { settings?: unknown } | null)?.settings ?? null)).analysisYears
  const v = validateEscalationOverrides(input.form ?? {}, years)
  if (Object.keys(v.errors).length > 0) return { fieldErrors: v.errors }
  const escalation = Object.keys(v.overrides).length > 0 ? { version: 1, overrides: v.overrides } : null
  const r = await updateStudy(g.supabase, input.projectId, input.expectedUpdatedAt, { escalation })
  if ('error' in r) return r
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'escalation_saved', objectRef: { years: Object.keys(v.overrides).length } })
  refresh(input.projectId)
  return r
}

// ── Project override (D-10) ─────────────────────────────────────────────────
export async function createSolarTariffOverrideAction(input: { projectId: string; expectedUpdatedAt: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').rpc('create_tariff_override', {
    p_project_id: input.projectId, p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_created' })
  refresh(input.projectId)
  return { ok: true }
}

export async function revertSolarTariffOverrideAction(input: { projectId: string; expectedUpdatedAt: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').rpc('revert_tariff_override', {
    p_project_id: input.projectId, p_expected_updated_at: input.expectedUpdatedAt,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_reverted' })
  refresh(input.projectId)
  return { ok: true }
}

export async function editSolarOverrideChargeAction(input: { projectId: string; chargeId: string; form: OverrideEditForm; expectedUpdatedAt: string }):
  Promise<{ ok: true } | { error: string } | { fieldErrors: Partial<Record<'amount' | 'unit' | 'reason', string>> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const t = g.supabase.schema('solar').from('tariff_override_charges')
  const { data: row } = await t.select('id, component, season').eq('id', input.chargeId).eq('project_id', input.projectId).maybeSingle()
  const c = row as { component: ChargeComponent; season: TariffSeason } | null
  if (!c) return { error: 'That rate no longer exists. Reload the page.' }
  const v = validateOverrideEdit({ component: c.component, season: c.season }, input.form)
  if ('errors' in v) return { fieldErrors: v.errors }
  const { data, error } = await g.supabase.schema('solar').from('tariff_override_charges')
    .update({ amount_excl_vat: v.amountExclVat, unit: v.unit, reason: v.reason })
    .eq('id', input.chargeId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('id')
  if (error) return { error: humanSolarTariffError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_override_row_edited', objectRef: { chargeId: input.chargeId } })
  refresh(input.projectId)
  return { ok: true }
}

// ── Bill check ──────────────────────────────────────────────────────────────
export interface BillCheckOutcome {
  modelled: number
  actual: number
  differencePct: number
  warn: boolean
  notModelled: string[]
}

/**
 * Costs the month with 2a's bill engine (costMonth, via runBillCheck) on the
 * effective tariff. The engine charges R_per_month once per month with no
 * proration, and R_per_day by the calendar day count of the billing month.
 */
export async function recordSolarBillCheckAction(input: { projectId: string; form: BillCheckForm }):
  Promise<{ ok: true; result: BillCheckOutcome } | { error: string } | { fieldErrors: Partial<Record<BillCheckField, string>> }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const eff = await loadEffectiveTariff(g.supabase, input.projectId, new Date().toISOString().slice(0, 10))
  if ('error' in eff) return eff
  const v = validateBillCheckForm(input.form, isTouTariff(eff.tariff.structure, eff.tariff.charges))
  if ('errors' in v) return { fieldErrors: v.errors }
  let res
  try {
    res = runBillCheck(eff.tariff, v.input, { highSeasonMonths: eff.highSeasonMonths, nmdKva: eff.nmdKva })
  } catch (e) {
    if (e instanceof BillCheckError) return { error: e.message }
    console.error('[solar-bill-check] engine failed', { projectId: input.projectId, err: String(e) })
    return { error: 'The bill could not be modelled. Report it as a tariff error.' }
  }
  const month = `${v.input.year}-${String(v.input.month).padStart(2, '0')}`
  const { error } = await g.supabase.schema('solar').from('bill_checks').insert({
    study_id: eff.studyId, billing_month: `${month}-01`, tariff_id: eff.tariffId, tariff_override_id: eff.overrideId,
    import_kwh_peak: v.input.importKwh.peak, import_kwh_standard: v.input.importKwh.standard, import_kwh_off_peak: v.input.importKwh.off_peak,
    max_demand_kva: v.input.maxDemandKva, actual_total_excl_vat: v.input.actualTotalExclVat,
    modelled_total_excl_vat: res.modelledTotalExclVat, difference_pct: res.differencePct,
    modelled: {
      season: res.season,
      lines: res.lines.map((l) => ({ label: l.label, quantity: l.quantity, quantityUnit: l.quantityUnit, rate: l.rate, rateUnit: l.rateUnit, amount: roundCents(l.amount) })),
      notModelled: res.notModelled,
    },
    engine_version: BILL_ENGINE_VERSION, note: v.input.note,
  })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'bill_check_recorded', objectRef: { billingMonth: month } })
  refresh(input.projectId)
  return {
    ok: true,
    result: {
      modelled: res.modelledTotalExclVat, actual: v.input.actualTotalExclVat, differencePct: res.differencePct, warn: res.warn,
      notModelled: res.notModelled.map((n) => n.reason),
    },
  }
}

export async function deleteSolarBillCheckAction(input: { projectId: string; id: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('bill_checks').delete().eq('id', input.id).eq('project_id', input.projectId)
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'bill_check_deleted', objectRef: { billCheckId: input.id } })
  refresh(input.projectId)
  return { ok: true }
}

// ── Report a tariff error (index D2b-3: a platform queue, not a work item) ──
export async function reportTariffErrorAction(input: { projectId: string; tariffId: string; note: string }): Promise<{ ok: true } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  const note = String(input.note ?? '').trim()
  if (!note) return { error: 'Describe what looks wrong.' }
  if (note.length > 2000) return { error: 'Keep the note under 2000 characters.' }
  if (!UUID.test(input.tariffId)) return { error: 'Choose a tariff first.' }
  const { error } = await g.supabase.schema('tariffs').from('error_report').insert({ tariff_id: input.tariffId, project_id: input.projectId, note })
  if (error) return { error: humanSolarTariffError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'tariff_error_reported', objectRef: { tariffId: input.tariffId } })
  return { ok: true }
}

// ── View source (a signed URL minted after the gate) ────────────────────────
export async function getSolarTariffSourceUrlAction(input: { projectId: string; sourceDocumentId: string }):
  Promise<{ url: string; kind: 'pdf' | 'xlsx' | 'link' } | { error: string }> {
  const g = await gate(input.projectId)
  if ('error' in g) return g
  // Read through the caller's session: 00209 lets subscribed orgs read source documents.
  const { data } = await g.supabase.schema('tariffs').from('source_document').select('storage_path, url').eq('id', input.sourceDocumentId).maybeSingle()
  const doc = data as { storage_path: string | null; url: string | null } | null
  if (!doc) return { error: 'That source document is not available.' }
  if (doc.storage_path) {
    const svc = createServiceClient() as unknown as AnyClient
    const { data: s, error } = await svc.storage.from('tariff-sources').createSignedUrl(doc.storage_path, 600)
    if (error || !s) return { error: 'Could not open the source document. Try again.' }
    return { url: s.signedUrl, kind: doc.storage_path.toLowerCase().endsWith('.pdf') ? 'pdf' : 'xlsx' }
  }
  if (doc.url) return { url: doc.url, kind: 'link' }
  return { error: 'This source has no stored file or link.' }
}
