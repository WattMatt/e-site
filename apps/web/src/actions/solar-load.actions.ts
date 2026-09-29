// apps/web/src/actions/solar-load.actions.ts
'use server'
/**
 * Load tab writes (functional spec §4). Each action re-checks Solar Edit itself and writes with the
 * caller's session, so 00211/00215's RESTRICTIVE solar_can_edit policies and bind triggers decide;
 * library writes (meters, register) additionally need the org library at Edit. Saves carry
 * expectedUpdatedAt and a stale write is refused (spec §0.4 rule 2).
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'
import {
  EMPTY_BILLS_FORM, validateLoadSettings, type BillsForm, type LoadBasisChoice, type LoadSettingsField, type LoadSettingsForm,
} from '@esite/shared'
import { ARCHETYPE_OPTIONS, METER_KIND_OPTIONS, isVacantTenant, type MeterKind } from '@/lib/solar/load/view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Ok<T = object> = { ok: true } & T
type Err = { error: string }

const NOT_IN_STUDY = 'That meter is not in this study.'
const path = (projectId: string) => `/projects/${projectId}/solar/load`

async function ctx(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
async function studyOf(supabase: AnyClient, projectId: string): Promise<{ id: string; updated_at: string } | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as { id: string; updated_at: string } | null) ?? null
}
async function inStudy(supabase: AnyClient, studyId: string, meterIds: string[]): Promise<boolean> {
  if (meterIds.length === 0) return true
  const { data } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', studyId).in('meter_id', meterIds)
  return new Set(((data ?? []) as Array<{ meter_id: string }>).map((r) => r.meter_id)).size === new Set(meterIds).size
}
async function projectNode(supabase: AnyClient, projectId: string, nodeId: string): Promise<boolean> {
  const { data } = await supabase.schema('structure').from('nodes').select('id').eq('id', nodeId).eq('project_id', projectId).eq('kind', 'tenant_db').maybeSingle()
  return Boolean(data)
}
function human(err: { code?: string; message?: string } | null): string {
  const m = err?.message ?? ''
  if (err?.code === '42501') return 'You do not have permission to do that.'
  if (m.includes('another organisation')) return 'That belongs to another organisation.'
  if (m.includes('another project')) return 'That tenant is not in this project.'
  if (m.includes('weight')) return 'Every meter weight must be greater than 0.'
  if (err?.code === '23505') return STALE_MESSAGE
  return GENERIC_ERROR
}

export async function ensureSolarStudyAction(projectId: string): Promise<Ok<{ studyId: string; updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const s = await studyOf(supabase, projectId)
  if (s) return { ok: true, studyId: s.id, updatedAt: s.updated_at }
  const { data, error } = await supabase.schema('solar').from('studies').insert({ project_id: projectId }).select('id, updated_at')
  const row = Array.isArray(data) ? (data[0] as { id: string; updated_at: string } | undefined) : undefined
  if (error || !row) {
    const again = await studyOf(supabase, projectId)  // a concurrent first save
    return again ? { ok: true, studyId: again.id, updatedAt: again.updated_at } : { error: human(error) }
  }
  return { ok: true, studyId: row.id, updatedAt: row.updated_at }
}

async function updateStudy(supabase: AnyClient, projectId: string, values: Record<string, unknown>, expectedUpdatedAt: string | null): Promise<Ok<{ updatedAt: string }> | Err> {
  if (expectedUpdatedAt === null) {
    const { data, error } = await supabase.schema('solar').from('studies').insert({ project_id: projectId, ...values }).select('updated_at')
    if (error) return { error: error.code === '23505' ? STALE_MESSAGE : human(error) }
    return { ok: true, updatedAt: (Array.isArray(data) ? (data[0]?.updated_at as string | undefined) : undefined) ?? '' }
  }
  const { data, error } = await supabase.schema('solar').from('studies').update(values)
    .eq('project_id', projectId).eq('updated_at', expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function saveLoadBasisAction(input: { projectId: string; basis: LoadBasisChoice; expectedUpdatedAt: string | null }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!['S1', 'S2', 'S4'].includes(input.basis)) return { error: 'Choose a load basis.' }
  const r = await updateStudy(supabase, input.projectId, { load_basis: input.basis }, input.expectedUpdatedAt)
  if ('ok' in r) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'load_basis_saved', objectRef: { basis: input.basis } })
    revalidatePath(path(input.projectId))
  }
  return r
}

export async function saveLoadSettingsAction(input: {
  projectId: string; form: LoadSettingsForm; bills: BillsForm; expectedUpdatedAt: string | null
}): Promise<Ok<{ updatedAt: string }> | Err | { fieldErrors: Partial<Record<LoadSettingsField, string>> }> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  // Directly invocable: coerce every field to a string so a malformed body gets sentences, not a TypeError.
  const f = (input.form ?? {}) as unknown as Record<string, unknown>
  const s = (k: string) => (f[k] == null ? '' : String(f[k]))
  // The basis that decides whether bills are required is the SAVED one (the Load basis bar owns it);
  // the client's copy may be stale. Neither the basis nor the allowance is written here.
  const { data: saved } = await supabase.schema('solar').from('studies').select('load_basis').eq('project_id', input.projectId).maybeSingle()
  const savedBasis = (saved as { load_basis?: string | null } | null)?.load_basis
  const loadBasis: LoadSettingsForm['loadBasis'] = savedBasis === 'S3' ? 'S2' : savedBasis === 'S1' || savedBasis === 'S2' || savedBasis === 'S4' ? savedBasis : ''
  const form: LoadSettingsForm = { loadBasis, referenceYear: s('referenceYear'), loadGrowthPct: s('loadGrowthPct'), diversityFactor: s('diversityFactor'), commonAreaPct: s('commonAreaPct') }
  const b = input.bills && Array.isArray(input.bills.months) && input.bills.months.length === 12 ? input.bills : EMPTY_BILLS_FORM
  const bills: BillsForm = { archetype: b.archetype, powerFactor: String(b.powerFactor ?? ''), months: b.months.map((m) => ({ kwh: String(m?.kwh ?? ''), kva: String(m?.kva ?? '') })) }
  const check = validateLoadSettings(form, bills)
  if (Object.keys(check.errors).length > 0) return { fieldErrors: check.errors }
  const r = await updateStudy(supabase, input.projectId, check.values as unknown as Record<string, unknown>, input.expectedUpdatedAt)
  if ('ok' in r) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'load_settings_saved' })
    revalidatePath(path(input.projectId))
  }
  return r
}

export async function saveCommonAreaAction(input: { projectId: string; commonAreaPct: number; expectedUpdatedAt: string | null }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!(Number.isFinite(input.commonAreaPct) && input.commonAreaPct >= 0 && input.commonAreaPct <= 100)) return { error: 'Common-area allowance must be between 0 and 100 %' }
  const r = await updateStudy(supabase, input.projectId, { common_area_pct: input.commonAreaPct }, input.expectedUpdatedAt)
  if ('ok' in r) revalidatePath(path(input.projectId))
  return r
}

export interface MeterPatch { label?: string; kind?: MeterKind; nodeId?: string | null; supplyPointConfirmed?: boolean; areaM2?: number | null }

export async function updateStudyMeterAction(input: { projectId: string; meterId: string; patch: MeterPatch; expectedUpdatedAt: string }): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || !(await inStudy(supabase, study.id, [input.meterId]))) return { error: NOT_IN_STUDY }
  const p = input.patch ?? {}
  const values: Record<string, unknown> = {}
  if (p.label !== undefined) {
    if (typeof p.label !== 'string' || p.label.trim().length === 0 || p.label.length > 200) return { error: 'A meter needs a label.' }
    values.label = p.label.trim()
  }
  if (p.kind !== undefined) {
    if (!METER_KIND_OPTIONS.some((k) => k.value === p.kind)) return { error: 'Choose a meter kind.' }
    values.kind = p.kind
  }
  if (p.nodeId !== undefined) {
    if (p.nodeId !== null && !(await projectNode(supabase, input.projectId, p.nodeId))) return { error: 'That tenant is not in this project.' }
    values.node_id = p.nodeId
  }
  if (p.supplyPointConfirmed !== undefined) {
    const { data: m } = await supabase.schema('solar').from('meters').select('kind').eq('id', input.meterId).maybeSingle()
    const kind = (values.kind as string | undefined) ?? (m as { kind?: string } | null)?.kind
    if (p.supplyPointConfirmed && kind !== 'bulk') return { error: 'Only a bulk meter can be the point of supply.' }
    values.supply_point_confirmed = Boolean(p.supplyPointConfirmed)
  }
  if (values.kind !== undefined && values.kind !== 'bulk') values.supply_point_confirmed = false
  if (p.areaM2 !== undefined) {
    if (p.areaM2 !== null && !(Number.isFinite(p.areaM2) && p.areaM2 > 0)) return { error: 'Area must be a positive number of m².' }
    values.area_m2 = p.areaM2
    values.area_source = p.areaM2 === null ? null : 'manual'
  }
  if (Object.keys(values).length === 0) return { error: 'Nothing to save.' }
  const { data, error } = await supabase.schema('solar').from('meters').update(values)
    .eq('id', input.meterId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_updated', objectRef: { meterId: input.meterId, fields: Object.keys(values) } })
  revalidatePath(path(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function removeStudyMeterAction(input: { projectId: string; meterId: string; alsoDeleteFromLibrary: boolean }): Promise<Ok<{ deletedFromLibrary: boolean; note?: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || !(await inStudy(supabase, study.id, [input.meterId]))) return { error: NOT_IN_STUDY }
  const solar = () => supabase.schema('solar')

  const { data: basisRows } = await solar().from('tenant_load_basis').select('id, source, meters, updated_at').eq('study_id', study.id)
  for (const b of (basisRows ?? []) as Array<{ id: string; source: string; meters: Array<{ meter_id: string; weight: number }>; updated_at: string }>) {
    if (!b.meters.some((m) => m.meter_id === input.meterId)) continue
    const meters = b.meters.filter((m) => m.meter_id !== input.meterId)
    // Read-modify-write of the meters array: pinned to the version read, so a concurrent
    // assignment edit is refused rather than silently overwritten.
    const { data, error } = await solar().from('tenant_load_basis').update({ meters, source: b.source === 'metered' && meters.length === 0 ? 'synthesised' : b.source })
      .eq('id', b.id).eq('updated_at', b.updated_at).select('id')
    if (error) return { error: human(error) }
    if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  }
  const { data: schematics } = await solar().from('schematics').select('id').eq('study_id', study.id)
  const schematicIds = ((schematics ?? []) as Array<{ id: string }>).map((s) => s.id)
  if (schematicIds.length > 0) {
    const { error } = await solar().from('schematic_cards').delete().in('schematic_id', schematicIds).eq('meter_id', input.meterId)
    if (error) return { error: human(error) }
  }
  const { error: unlinkErr } = await solar().from('study_meters').delete().eq('study_id', study.id).eq('meter_id', input.meterId)
  if (unlinkErr) return { error: human(unlinkErr) }

  // The removal from THIS study has landed by here; a library delete that cannot follow is a note on a
  // success (the drawer closes and the list refreshes), not an error.
  let deleted = false
  let note: string | undefined
  if (input.alsoDeleteFromLibrary) {
    const { data: others } = await solar().from('study_meters').select('study_id').eq('meter_id', input.meterId).neq('study_id', study.id)
    if (Array.isArray(others) && others.length > 0) note = 'Removed from this study; the meter is still used by another study, so it stays in the library.'
    else {
      const { data, error } = await solar().from('meters').delete().eq('id', input.meterId).select('id')
      if (error) note = `Removed from this study; it could not be deleted from the library (${human(error)})`
      else if (!Array.isArray(data) || data.length === 0) note = 'Removed from this study; only an org owner or admin can delete it from the library.'
      else deleted = true
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: deleted ? 'meter_deleted_from_library' : 'meter_removed_from_study', objectRef: { meterId: input.meterId } })
  revalidatePath(path(input.projectId))
  return note ? { ok: true, deletedFromLibrary: deleted, note } : { ok: true, deletedFromLibrary: deleted }
}

export interface LibraryMeterHit { id: string; label: string; siteLabel: string | null; kind: string; serials: string[] }

export async function searchLibraryMetersAction(input: { projectId: string; query: string }): Promise<Ok<{ meters: LibraryMeterHit[] }> | Err> {
  const { supabase } = await ctx(input.projectId)
  const q = String(input.query ?? '').trim().slice(0, 80)
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  if (!orgId) return { error: GENERIC_ERROR }
  const study = await studyOf(supabase, input.projectId)
  const linked = study
    ? new Set((((await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', study.id)).data ?? []) as Array<{ meter_id: string }>).map((r) => r.meter_id))
    : new Set<string>()
  const esc = q.replace(/[\\%_,()]/g, (c) => `\\${c}`)
  let query = supabase.schema('solar').from('meters').select('id, label, site_label, kind, serials').eq('organisation_id', orgId)
  if (q) query = query.or(`label.ilike.%${esc}%,site_label.ilike.%${esc}%,serials.cs.{${esc}}`)
  const { data, error } = await query.order('label').limit(50)
  if (error) return { error: human(error) }
  return {
    ok: true,
    meters: ((data ?? []) as Array<{ id: string; label: string; site_label: string | null; kind: string; serials: string[] | null }>)
      .filter((m) => !linked.has(m.id))
      .map((m) => ({ id: m.id, label: m.label, siteLabel: m.site_label, kind: m.kind, serials: m.serials ?? [] })),
  }
}

export async function linkLibraryMetersAction(input: { projectId: string; meterIds: string[] }): Promise<Ok<{ linked: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const ids = [...new Set((input.meterIds ?? []).filter((x) => typeof x === 'string'))].slice(0, 200)
  if (ids.length === 0) return { error: 'Choose at least one meter.' }
  const ensured = await ensureSolarStudyAction(input.projectId)
  if ('error' in ensured) return ensured
  const { error } = await supabase.schema('solar').from('study_meters')
    .upsert(ids.map((meter_id) => ({ study_id: ensured.studyId, meter_id })), { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
  if (error) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meters_copied_from_library', objectRef: { count: ids.length } })
  revalidatePath(path(input.projectId))
  return { ok: true, linked: ids.length }
}

export async function saveTenantBasisAction(input: {
  projectId: string; nodeId: string; source: 'metered' | 'synthesised' | 'excluded'; meters: Array<{ meterId: string; weight: number }>
  archetype: string | null; densityOverride: number | null; expectedUpdatedAt: string | null
}): Promise<Ok<{ updatedAt: string }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!['metered', 'synthesised', 'excluded'].includes(input.source)) return { error: 'Choose a load source.' }
  const meters = Array.isArray(input.meters) ? input.meters : []
  if (input.source === 'metered' && meters.length === 0) return { error: 'A metered tenant needs at least one meter.' }
  if (meters.some((m) => !(typeof m.weight === 'number' && Number.isFinite(m.weight) && m.weight > 0))) return { error: 'Every meter weight must be greater than 0.' }
  if (input.archetype !== null && !ARCHETYPE_OPTIONS.some((a) => a.value === input.archetype)) return { error: 'Choose an archetype.' }
  if (input.densityOverride !== null && !(Number.isFinite(input.densityOverride) && input.densityOverride > 0 && input.densityOverride <= 2000)) return { error: 'Density must be between 0 and 2,000 W/m².' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  if (!(await inStudy(supabase, study.id, meters.map((m) => m.meterId)))) return { error: NOT_IN_STUDY }
  if (!(await projectNode(supabase, input.projectId, input.nodeId))) return { error: 'That tenant is not in this project.' }
  const row = {
    source: input.source,
    meters: meters.map((m) => ({ meter_id: m.meterId, weight: m.weight })),
    archetype: input.archetype,
    density_override_w_m2: input.densityOverride,
  }
  const t = supabase.schema('solar').from('tenant_load_basis')
  const res = input.expectedUpdatedAt === null
    ? await t.insert({ study_id: study.id, node_id: input.nodeId, ...row }).select('updated_at')
    : await t.update(row).eq('study_id', study.id).eq('node_id', input.nodeId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : human(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'tenant_load_basis_saved', objectRef: { nodeId: input.nodeId, source: input.source } })
  revalidatePath(path(input.projectId))
  return { ok: true, updatedAt: res.data[0]?.updated_at as string }
}

/**
 * Apply the auto-match pairs the user ticked. Every write is pinned on the version the USER SAW (sent
 * with each pair from the Tenants view), not on one this call reads: a tenant assignment or meter
 * changed by someone else since the page loaded is refused / reported, never overwritten. A pair
 * with no meter version to pin on is reported stale (no write with an empty timestamp).
 */
export async function applyAutoMatchAction(input: {
  projectId: string
  pairs: Array<{ nodeId: string; meterId: string; meterUpdatedAt: string | null; basisUpdatedAt: string | null }>
}): Promise<Ok<{ applied: number; staleMeters: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const pairs = (input.pairs ?? []).slice(0, 500)
  if (pairs.length === 0) return { error: 'Tick at least one proposed pair.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  if (!(await inStudy(supabase, study.id, pairs.map((p) => p.meterId)))) return { error: NOT_IN_STUDY }
  const solar = () => supabase.schema('solar')
  const { data: rows } = await solar().from('tenant_load_basis').select('node_id, meters').eq('study_id', study.id)
  const existing = new Map(((rows ?? []) as Array<{ node_id: string; meters: Array<{ meter_id: string; weight: number }> }>).map((r) => [r.node_id, r.meters]))
  const { data: meterRows } = await solar().from('meters').select('id, node_id').in('id', [...new Set(pairs.map((p) => p.meterId))])
  const linkedTo = new Map(((meterRows ?? []) as Array<{ id: string; node_id: string | null }>).map((m) => [m.id, m.node_id]))
  const pin = (v: unknown) => (typeof v === 'string' && v.length > 0 ? v : null)
  const byNode = new Map<string, { basisUpdatedAt: string | null; meters: Array<{ meterId: string; meterUpdatedAt: string | null }> }>()
  for (const p of pairs) {
    const g = byNode.get(p.nodeId) ?? { basisUpdatedAt: pin(p.basisUpdatedAt), meters: [] }
    g.meters.push({ meterId: p.meterId, meterUpdatedAt: pin(p.meterUpdatedAt) })
    byNode.set(p.nodeId, g)
  }
  let applied = 0
  let staleMeters = 0
  for (const [nodeId, g] of byNode) {
    if (!(await projectNode(supabase, input.projectId, nodeId))) return { error: 'That tenant is not in this project.' }
    const have = existing.get(nodeId) ?? []
    const merged = [...have, ...g.meters.filter((x) => !have.some((m) => m.meter_id === x.meterId)).map((x) => ({ meter_id: x.meterId, weight: 1 }))]
    // No row seen → insert (a row created since races into 23505 → stale). A row seen → update pinned
    // on the user's version (a concurrent edit matches zero rows → stale).
    const res = g.basisUpdatedAt === null
      ? await solar().from('tenant_load_basis').insert({ study_id: study.id, node_id: nodeId, source: 'metered', meters: merged }).select('id')
      : await solar().from('tenant_load_basis').update({ source: 'metered', meters: merged }).eq('study_id', study.id).eq('node_id', nodeId).eq('updated_at', g.basisUpdatedAt).select('id')
    if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : human(res.error) }
    if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }
    for (const { meterId, meterUpdatedAt } of g.meters) {
      if (linkedTo.get(meterId) === nodeId) { applied++; continue }  // already linked: nothing to write
      if (meterUpdatedAt === null) { staleMeters++; continue }       // nothing to pin on: never write
      const { data, error } = await solar().from('meters').update({ node_id: nodeId }).eq('id', meterId).eq('updated_at', meterUpdatedAt).select('id')
      if (error) return { error: human(error) }
      if (Array.isArray(data) && data.length > 0) applied++
      else staleMeters++
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meters_auto_matched', objectRef: { applied } })
  revalidatePath(path(input.projectId))
  return { ok: true, applied, staleMeters }
}

/**
 * Exclude the vacant tenants the user saw. Re-checks vacancy server-side (a directly-invoked call
 * cannot exclude a trading tenant), pins every row on the version the USER SAW (`expectedUpdatedAt`,
 * null = the user saw no row → insert only), and never clears a row's meters (source only — including
 * it again restores them). A row changed since the page loaded is REPORTED, not overwritten; the
 * count is what actually landed.
 */
export async function excludeVacantAction(input: {
  projectId: string
  rows: Array<{ nodeId: string; expectedUpdatedAt: string | null }>
}): Promise<Ok<{ count: number; stale: string[]; notVacant: number }> | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const seen = new Map<string, string | null>()
  for (const r of input.rows ?? []) {
    if (r && typeof r.nodeId === 'string' && !seen.has(r.nodeId)) seen.set(r.nodeId, typeof r.expectedUpdatedAt === 'string' && r.expectedUpdatedAt.length > 0 ? r.expectedUpdatedAt : null)
    if (seen.size >= 1000) break
  }
  const nodeIds = [...seen.keys()]
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Set up the study first — save Site & Supply or any Load setting.' }
  if (nodeIds.length === 0) return { ok: true, count: 0, stale: [], notVacant: 0 }
  const solar = () => supabase.schema('solar')
  const { data: nodeRows } = await supabase.schema('structure').from('nodes').select('id, shop_number, shop_name, name')
    .in('id', nodeIds).eq('project_id', input.projectId).eq('kind', 'tenant_db')
  const nodes = ((nodeRows ?? []) as Array<{ id: string; shop_number: string | null; shop_name: string | null; name: string | null }>).filter(isVacantTenant)
  const label = (n: (typeof nodes)[number]) => `${n.shop_number ?? ''} ${n.shop_name ?? n.name ?? ''}`.trim()
  let count = 0
  const stale: string[] = []
  for (const n of nodes) {
    const expected = seen.get(n.id) ?? null
    const res = expected !== null
      ? await solar().from('tenant_load_basis').update({ source: 'excluded' }).eq('study_id', study.id).eq('node_id', n.id).eq('updated_at', expected).select('id')
      : await solar().from('tenant_load_basis').insert({ study_id: study.id, node_id: n.id, source: 'excluded', meters: [] }).select('id')
    if (res.error && res.error.code !== '23505') return { error: human(res.error) }
    if (res.error || !Array.isArray(res.data) || res.data.length === 0) { stale.push(label(n)); continue }
    count++
  }
  if (count > 0) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'vacant_tenants_excluded', objectRef: { count } })
  revalidatePath(path(input.projectId))
  return { ok: true, count, stale, notVacant: nodeIds.length - nodes.length }
}

export async function acknowledgeCheckAction(input: { projectId: string; checkKey: string; note: string | null }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const key = String(input.checkKey ?? '').trim()
  if (key.length === 0 || key.length > 300) return { error: GENERIC_ERROR }
  const note = input.note == null ? null : String(input.note).slice(0, 1000)
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { error } = await supabase.schema('solar').from('load_check_acks').insert({ study_id: study.id, check_key: key, note })
  if (error && error.code !== '23505') return { error: human(error) }
  revalidatePath(path(input.projectId))
  return { ok: true }
}

export async function unacknowledgeCheckAction(input: { projectId: string; checkKey: string }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { error } = await supabase.schema('solar').from('load_check_acks').delete().eq('study_id', study.id).eq('check_key', String(input.checkKey ?? ''))
  if (error) return { error: human(error) }
  revalidatePath(path(input.projectId))
  return { ok: true }
}

export async function confirmRegisterRowAction(input: { projectId: string; rowId: string }): Promise<Ok | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  const { data, error } = await supabase.schema('solar').from('meter_register').update({ confirmed_at: new Date().toISOString() })
    .eq('id', input.rowId).eq('organisation_id', orgId ?? '').is('confirmed_at', null).select('id')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_register_row_confirmed', objectRef: { rowId: input.rowId } })
  revalidatePath(path(input.projectId))
  return { ok: true }
}
