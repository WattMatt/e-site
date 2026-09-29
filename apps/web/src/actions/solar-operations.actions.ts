'use server'
/**
 * Operations tab actions (spec §10). Every action gates its Solar level FIRST (requireSolarLevel
 * redirects a lower level), writes through the caller's session so 00217's RESTRICTIVE policies and
 * bind triggers decide, and reports trigger refusals in their own words (opsError).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { CAUSE_LABELS, isMonthKey, monthFirstDay, parseAsBuilt, parseGuarantee, sastLocalToIso, templateFromRow } from '@esite/shared/solar-operations'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { INSTALL_REASONS, loadInstallationSeed } from '@/lib/solar/operations/baseline-loader'
import { opsError } from '@/lib/solar/operations/errors'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type Err = { error: string }
type FieldErrors = { fieldErrors: Record<string, string> }

const DATE_RE = /^(\d{4})-(\d{2})-(\d{2})$/
function realDate(s: string): boolean {
  const m = DATE_RE.exec(s)
  if (!m) return false
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])))
  return d.getUTCFullYear() === Number(m[1]) && d.getUTCMonth() === Number(m[2]) - 1 && d.getUTCDate() === Number(m[3]) && Number(m[1]) >= 2000
}

async function gate(projectId: string, need: 'view' | 'edit' | 'edit_financials'): Promise<{ supabase: AnyClient; userId: string } | Err> {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, need, supabase)
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return { error: 'You are not signed in.' }
  return { supabase, userId: user.id }
}
const done = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

// ── Installation ──────────────────────────────────────────────────────────
export async function createInstallationAction(input: { projectId: string }): Promise<{ ok: true; installationId: string; warning: string | null } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { supabase, userId } = g
  const { data: study } = await supabase.schema('solar').from('studies').select('id, organisation_id').eq('project_id', input.projectId).maybeSingle()
  if (!study) return { error: INSTALL_REASONS.noStudy }
  const s = study as Row
  const seed = await loadInstallationSeed(createServiceClient() as unknown as AnyClient, String(s.id))
  if (!seed.ok) return { error: seed.reason }

  const { data, error } = await supabase.schema('solar').from('installations')
    .insert({ study_id: s.id, proposal_id: seed.proposalId, baseline: seed.baseline, as_built: seed.asBuilt }).select('id')
  if (error) return { error: error.code === '23505' ? INSTALL_REASONS.exists : opsError(error) }
  const installationId = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!installationId) return { error: 'Could not record the installation — try again.' }

  // The guarantee starts as the accepted case's P50 with the case's own degradation: nobody retypes it.
  const warnings: string[] = []
  const { error: gErr } = await supabase.schema('solar').from('guarantees')
    .insert({ installation_id: installationId, basis: 'p50', degradation_pct_per_year: seed.degradationPctPerYear })
  if (gErr) warnings.push('The guarantee basis could not be saved — set it on the Guarantee card.')
  const { data: tpl } = await supabase.schema('solar').from('handover_templates').select('name, items').eq('organisation_id', s.organisation_id).maybeSingle()
  const template = templateFromRow((tpl as { name: unknown; items: unknown } | null) ?? null)
  const { error: hErr } = await supabase.schema('solar').from('handover_items').insert(
    template.items.map((it, k) => ({ installation_id: installationId, item_key: it.key, label: it.label, required: it.required, sort_order: k })))
  if (hErr) warnings.push('The handover checklist could not be created — use "Add missing items" on the checklist.')

  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'installation_created', objectRef: { installationId, proposalId: seed.proposalId } })
  await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'created' } })
  done(input.projectId)
  return { ok: true, installationId, warning: warnings.length ? warnings.join(' ') : null }
}

export async function saveInstallationAction(input: {
  projectId: string; installationId: string; commissioningDate: string | null; asBuilt: unknown; notes: string | null; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const fieldErrors: Record<string, string> = {}
  const date = input.commissioningDate === null || input.commissioningDate === '' ? null : String(input.commissioningDate)
  if (date !== null && !realDate(date)) fieldErrors.commissioningDate = 'Enter a real date (YYYY-MM-DD).'
  const ab = parseAsBuilt(input.asBuilt)
  if (!ab.ok) fieldErrors.asBuilt = ab.errors.join('; ')
  const notes = typeof input.notes === 'string' ? input.notes.trim() : ''
  if (notes.length > 5000) fieldErrors.notes = 'At most 5000 characters.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }

  const { data, error } = await g.supabase.schema('solar').from('installations')
    .update({ commissioning_date: date, as_built: ab.ok ? ab.value : null, notes: notes || null })
    .eq('id', input.installationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'installation_saved', objectRef: { installationId: input.installationId } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_installation_saved', properties: { action: 'saved' } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

// ── Meters ────────────────────────────────────────────────────────────────
const ROLES = ['generation', 'consumption'] as const

export async function linkMeterAction(input: { projectId: string; installationId: string; meterId: string; role: 'generation' | 'consumption' }): Promise<{ ok: true } | Err> {
  if (!(ROLES as readonly string[]).includes(input.role)) return { error: 'Unknown meter role.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters')
    .insert({ installation_id: input.installationId, meter_id: input.meterId, role: input.role })
  if (error) return { error: error.code === '23505' ? 'That meter is already linked.' : opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'meter_linked', objectRef: { meterId: input.meterId, role: input.role } })
  done(input.projectId)
  return { ok: true }
}

export async function unlinkMeterAction(input: { projectId: string; installationId: string; meterId: string }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters').delete()
    .eq('installation_id', input.installationId).eq('meter_id', input.meterId)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'meter_unlinked', objectRef: { meterId: input.meterId } })
  done(input.projectId)
  return { ok: true }
}

export async function setMeterShareAction(input: { projectId: string; installationId: string; meterId: string; sharePct: number | null }): Promise<{ ok: true } | Err> {
  if (input.sharePct !== null && !(typeof input.sharePct === 'number' && input.sharePct > 0 && input.sharePct <= 100)) return { error: 'A share is between 0 and 100 %.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('installation_meters').update({ expected_share_pct: input.sharePct })
    .eq('installation_id', input.installationId).eq('meter_id', input.meterId)
  if (error) return { error: opsError(error) }
  done(input.projectId)
  return { ok: true }
}

// ── Guarantee ─────────────────────────────────────────────────────────────
export async function saveGuaranteeAction(input: { projectId: string; installationId: string; guarantee: unknown; expectedUpdatedAt: string | null }):
  Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const parsed = parseGuarantee(input.guarantee)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const v = parsed.value
  const values = { basis: v.basis, pct: v.pct, manual_monthly_kwh: v.manualMonthlyKwh, degradation_pct_per_year: v.degradationPctPerYear }
  const t = () => g.supabase.schema('solar').from('guarantees')
  const { data, error } = input.expectedUpdatedAt === null
    ? await t().insert({ installation_id: input.installationId, ...values }).select('updated_at')
    : await t().update(values).eq('installation_id', input.installationId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'guarantee_saved', objectRef: { basis: v.basis } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_guarantee_saved', properties: { basis: v.basis } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

// ── Irradiation ───────────────────────────────────────────────────────────
export async function saveIrradiationAction(input: {
  projectId: string; installationId: string; month: string; plane: 'ghi' | 'poa'; kwhPerM2: number; sourceNote: string
}): Promise<{ ok: true } | Err | FieldErrors> {
  const fieldErrors: Record<string, string> = {}
  if (!isMonthKey(input.month)) fieldErrors.month = 'Choose a month.'
  if (input.plane !== 'ghi' && input.plane !== 'poa') fieldErrors.plane = 'Choose horizontal (GHI) or plane of array (POA).'
  if (!(typeof input.kwhPerM2 === 'number' && input.kwhPerM2 > 0 && input.kwhPerM2 <= 400)) fieldErrors.kwhPerM2 = 'Between 0 and 400 kWh/m².'
  const note = typeof input.sourceNote === 'string' ? input.sourceNote.trim() : ''
  if (note.length < 3 || note.length > 300) fieldErrors.sourceNote = 'Say where the figure comes from (3–300 characters).'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const t = () => g.supabase.schema('solar').from('ops_irradiation')
  const month = monthFirstDay(input.month)
  const { data: existing } = await t().select('month').eq('installation_id', input.installationId).eq('month', month).maybeSingle()
  const values = { plane: input.plane, kwh_per_m2: input.kwhPerM2, source_note: note }
  const { error } = existing
    ? await t().update(values).eq('installation_id', input.installationId).eq('month', month)
    : await t().insert({ installation_id: input.installationId, month, ...values })
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'irradiation_saved', objectRef: { month: input.month, plane: input.plane } })
  done(input.projectId)
  return { ok: true }
}

export async function deleteIrradiationAction(input: { projectId: string; installationId: string; month: string }): Promise<{ ok: true } | Err> {
  if (!isMonthKey(input.month)) return { error: 'Choose a month.' }
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('ops_irradiation').delete()
    .eq('installation_id', input.installationId).eq('month', monthFirstDay(input.month))
  if (error) return { error: opsError(error) }
  done(input.projectId)
  return { ok: true }
}

// ── Downtime ──────────────────────────────────────────────────────────────
// The same eight causes as 00217's CHECK (CAUSE_LABELS is the shared single source).
const CAUSES = Object.keys(CAUSE_LABELS)
const ISO_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{3})?Z$/

/** A datetime-local value (read as SAST) or an ISO UTC instant (a confirmed candidate). */
function when(v: unknown): string | null {
  if (typeof v !== 'string') return null
  if (ISO_RE.test(v) && Number.isFinite(Date.parse(v))) return new Date(v).toISOString()
  return sastLocalToIso(v)
}

function checkDowntime(i: { startsAt: unknown; endsAt: unknown; cause: unknown; description: unknown }):
  { ok: true; startsAt: string; endsAt: string; description: string | null } | FieldErrors {
  const fieldErrors: Record<string, string> = {}
  const s = when(i.startsAt)
  const e = when(i.endsAt)
  if (!s) fieldErrors.startsAt = 'Enter a date and time.'
  if (!e) fieldErrors.endsAt = 'Enter a date and time.'
  if (s && e && Date.parse(e) <= Date.parse(s)) fieldErrors.endsAt = 'The end must be after the start.'
  else if (s && e && Date.parse(e) - Date.parse(s) > 31 * 86_400_000) fieldErrors.endsAt = 'One entry covers at most 31 days — split longer outages.'
  if (typeof i.cause !== 'string' || !CAUSES.includes(i.cause)) fieldErrors.cause = 'Choose a cause.'
  const d = typeof i.description === 'string' ? i.description.trim() : ''
  if (d.length > 2000) fieldErrors.description = 'At most 2000 characters.'
  if (Object.keys(fieldErrors).length > 0) return { fieldErrors }
  return { ok: true, startsAt: s!, endsAt: e!, description: d || null }
}

export async function addDowntimeAction(input: {
  projectId: string; installationId: string; startsAt: string; endsAt: string; cause: string; description: string
  excludedFromGuarantee: boolean; source: 'manual' | 'detected'
}): Promise<{ ok: true; id: string } | Err | FieldErrors> {
  const c = checkDowntime(input)
  if (!('ok' in c)) return c
  const source = input.source === 'detected' ? 'detected' : 'manual'
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('downtime').insert({
    installation_id: input.installationId, starts_at: c.startsAt, ends_at: c.endsAt, cause: input.cause,
    description: c.description, excluded_from_guarantee: input.excludedFromGuarantee === true, source,
  }).select('id')
  if (error) return { error: opsError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Could not record the downtime — try again.' }
  const hours = Math.round(((Date.parse(c.endsAt) - Date.parse(c.startsAt)) / 3_600_000) * 100) / 100
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_added', objectRef: { id, hours, source } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_downtime_saved', properties: { action: 'added', source } })
  done(input.projectId)
  return { ok: true, id }
}

export async function updateDowntimeAction(input: {
  projectId: string; id: string; startsAt: string; endsAt: string; cause: string; description: string
  excludedFromGuarantee: boolean; expectedUpdatedAt: string
}): Promise<{ ok: true; updatedAt: string } | Err | FieldErrors> {
  const c = checkDowntime(input)
  if (!('ok' in c)) return c
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { data, error } = await g.supabase.schema('solar').from('downtime').update({
    starts_at: c.startsAt, ends_at: c.endsAt, cause: input.cause, description: c.description,
    excluded_from_guarantee: input.excludedFromGuarantee === true,
  }).eq('id', input.id).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: opsError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_updated', objectRef: { id: input.id } })
  await emitProductEvent({ actorId: g.userId, projectId: input.projectId, event: 'solar_downtime_saved', properties: { action: 'updated', source: 'manual' } })
  done(input.projectId)
  return { ok: true, updatedAt: String((data[0] as Row).updated_at) }
}

export async function deleteDowntimeAction(input: { projectId: string; id: string }): Promise<{ ok: true } | Err> {
  const g = await gate(input.projectId, 'edit')
  if ('error' in g) return g
  const { error } = await g.supabase.schema('solar').from('downtime').delete().eq('id', input.id)
  if (error) return { error: opsError(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: g.userId, verb: 'downtime_deleted', objectRef: { id: input.id } })
  done(input.projectId)
  return { ok: true }
}
