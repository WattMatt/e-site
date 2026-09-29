'use server'
/**
 * Yield & Scenarios case actions (functional spec §7.1–7.2). Each re-checks the Solar level itself and
 * writes through the caller's session (00215 RLS + bind triggers decide). The service client is used
 * only to read org_settings (owner/admin-only by RLS, but every Edit user's new case needs the org
 * defaults), the equipment catalogue for snapshots, and the weather cache.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings } from '@esite/shared'
import { defaultCaseConfig, parseCaseConfig, moduleSnapshot, inverterSnapshot, batterySnapshot, caseSizeFromLayout, type CaseConfig } from '@esite/shared/solar-cases'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE, humanSolarError } from '@/lib/solar/errors'
import { emitProductEvent } from '@/lib/analytics/product-events'
import { getOrFetchWeather } from '@/lib/solar/cases/weather'
import { loadLayoutDesign } from '@/lib/solar/cases/layout-design'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Row = Record<string, unknown>
type EquipmentRow = { id: string; make: string; model: string; specs: Record<string, unknown> }

export type CaseStart = { kind: 'manual'; dcKwp: number; acKw: number } | { kind: 'copy'; fromCaseId: string } | { kind: 'layout'; layoutId: string }
export type CaseActionResult = { ok: true; caseId: string } | { error: string } | { fieldErrors: Record<string, string> }
export type CaseSaveResult = { ok: true; updatedAt: string } | { error: string } | { fieldErrors: Record<string, string> }

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
const done = (projectId: string) => revalidatePath(`/projects/${projectId}/solar`, 'layout')

async function studyOf(supabase: AnyClient, projectId: string): Promise<Row | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id, organisation_id, latitude, longitude, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as Row | null) ?? null
}

async function insertCase(supabase: AnyClient, studyId: string, name: string, config: CaseConfig, layoutId: string | null = null): Promise<{ id: string } | { error: string } | { fieldErrors: Record<string, string> }> {
  const link = layoutId ? { pv_source: 'layout', layout_id: layoutId } : { pv_source: 'manual' }
  const { data, error } = await supabase.schema('solar').from('cases').insert({ study_id: studyId, name, ...link, config }).select('id, updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A case with this name already exists' } } : { error: humanSolarError(error) }
  return { id: (Array.isArray(data) ? data[0]?.id : (data as Row | null)?.id) as string }
}

export async function createSolarCaseAction(input: { projectId: string; name: string; start: CaseStart }): Promise<CaseActionResult> {
  const { projectId } = input
  const { supabase, userId } = await session(projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (!name) return { fieldErrors: { name: 'Enter a name' } }
  if (name.length > 120) return { fieldErrors: { name: 'Keep the name under 120 characters' } }
  const start = input.start
  if (!start || typeof start !== 'object') return { error: 'Choose how to start the case.' }
  if (start.kind === 'layout') {
    if (typeof start.layoutId !== 'string' || !start.layoutId) return { error: 'Choose a layout.' }
  } else if (start.kind === 'manual') {
    if (!(Number(start.dcKwp) > 0)) return { fieldErrors: { dcKwp: 'DC size must be greater than 0 kWp' } }
    if (!(Number(start.acKw) > 0)) return { fieldErrors: { acKw: 'AC size must be greater than 0 kW' } }
  } else if (start.kind !== 'copy') {
    return { error: 'Choose how to start the case.' }
  }
  const study = await studyOf(supabase, projectId)
  if (!study) return { error: 'Save Site & Supply first.' }

  let config: CaseConfig
  let layoutId: string | null = null
  if (start.kind === 'manual' || start.kind === 'layout') {
    let size: { dcKwp: number; acKw: number }
    if (start.kind === 'layout') {
      // Sizes from the layout's OWN objects (server-side), never from the client or stored summary.
      const design = await loadLayoutDesign(supabase, projectId, start.layoutId)
      if (!design) return { error: 'That layout no longer exists — reload.' }
      const sized = caseSizeFromLayout(design.summary)
      if (!sized.ok) return { error: sized.error }
      size = { dcKwp: sized.dcKwp, acKw: sized.acKw }
      layoutId = design.id
    } else size = { dcKwp: Number(start.dcKwp), acKw: Number(start.acKw) }
    const svc = createServiceClient() as unknown as AnyClient
    const { data: os } = await svc.schema('solar').from('org_settings').select('settings').eq('organisation_id', study.organisation_id as string).maybeSingle()
    const base = defaultCaseConfig(readSolarOrgSettings((os as Row | null)?.settings ?? null), size)
    config = layoutId ? { ...base, pv: { ...base.pv, source: 'layout' } } : base
  } else {
    const { data: src } = await supabase.schema('solar').from('cases').select('config, pv_source, layout_id').eq('id', start.fromCaseId).eq('project_id', projectId).maybeSingle()
    const parsed = parseCaseConfig((src as Row | null)?.config)
    if (!parsed.ok) return { error: 'The case to copy could not be read.' }
    // A copy keeps the source's layout link, so the row and config.pv.source agree (00218's FK and
    // cases_layout_bind re-check the layout). The row's pv_source is the truth for the config.
    const srcRow = src as { pv_source?: string; layout_id?: string | null }
    layoutId = srcRow.pv_source === 'layout' && srcRow.layout_id ? srcRow.layout_id : null
    config = { ...parsed.config, pv: { ...parsed.config.pv, source: layoutId ? 'layout' : 'manual' } }
  }
  const ins = await insertCase(supabase, study.id as string, name, config, layoutId)
  if (!('id' in ins)) return ins
  if (start.kind === 'copy') {
    // Financials copy only when the caller can READ them (RLS: solar_can_see_money); otherwise nothing.
    const { data: fin } = await supabase.schema('solar').from('case_financials').select('config').eq('case_id', start.fromCaseId)
    const row = Array.isArray(fin) ? (fin[0] as Row | undefined) : undefined
    if (row) {
      const { error } = await supabase.schema('solar').from('case_financials').insert({ case_id: ins.id, config: row.config })
      if (error) console.error('[solar-cases] financials copy failed', { projectId, caseId: ins.id, code: error.code })
    }
  }
  await recordSolarAudit({ projectId, actorId: userId, verb: 'case_created', objectRef: { caseId: ins.id } })
  await emitProductEvent({ actorId: userId, projectId, event: 'solar_case_created' })
  done(projectId)
  return { ok: true, caseId: ins.id }
}

export async function duplicateSolarCaseAction(input: { projectId: string; caseId: string }): Promise<CaseActionResult> {
  const { supabase } = await session(input.projectId)
  const { data: src } = await supabase.schema('solar').from('cases').select('name, study_id').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  if (!src) return { error: 'Case not found.' }
  const { data: all } = await supabase.schema('solar').from('cases').select('name').eq('study_id', (src as Row).study_id as string)
  const taken = new Set(((all ?? []) as Row[]).map((r) => String(r.name).trim().toLowerCase()))
  const base = `${String((src as Row).name)} (copy`
  let name = `${base})`
  for (let i = 2; taken.has(name.toLowerCase()); i++) name = `${base} ${i})`
  return createSolarCaseAction({ projectId: input.projectId, name, start: { kind: 'copy', fromCaseId: input.caseId } })
}

export async function renameSolarCaseAction(input: { projectId: string; caseId: string; name: string; expectedUpdatedAt: string }): Promise<CaseSaveResult> {
  const { supabase, userId } = await session(input.projectId)
  const name = String(input.name ?? '').trim()
  if (!name) return { fieldErrors: { name: 'Enter a name' } }
  if (name.length > 120) return { fieldErrors: { name: 'Keep the name under 120 characters' } }
  const { data, error } = await supabase.schema('solar').from('cases').update({ name })
    .eq('id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A case with this name already exists' } } : { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_renamed', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export async function deleteSolarCaseAction(input: { projectId: string; caseId: string }): Promise<{ ok: true } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  // 00216 cases_keep_issued_proposals refuses a case an issued proposal was made from (humanSolarError words it).
  const { data, error } = await supabase.schema('solar').from('cases').delete().eq('id', input.caseId).eq('project_id', input.projectId).select('id')
  if (error) return { error: error.code === '23503' ? 'This is the selected case — choose another selected case first.' : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was deleted — reload to see the current cases.' }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_deleted', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true }
}

export async function setSelectedSolarCaseAction(input: { projectId: string; caseId: string | null; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  const { data, error } = await supabase.schema('solar').from('studies').update({ selected_case_id: input.caseId })
    .eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: error.code === '23514' ? 'Only a case with a completed run can be selected.' : humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_selected', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export async function saveSolarCaseAction(input: { projectId: string; caseId: string; config: unknown; expectedUpdatedAt: string }): Promise<CaseSaveResult> {
  const { supabase, userId } = await session(input.projectId)
  const parsed = parseCaseConfig(input.config)
  if (!parsed.ok) return { fieldErrors: parsed.errors }
  let config = parsed.config
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: 'Save Site & Supply first.' }
  const svc = createServiceClient() as unknown as AnyClient
  const org = study.organisation_id as string

  // Snapshots are re-derived from the catalogue: a client cannot submit its own temperature coefficient.
  const ids = [config.pv.module?.equipmentId, config.pv.inverter?.equipmentId, config.battery.unit?.equipmentId].filter((v): v is string => Boolean(v))
  if (ids.length > 0) {
    const { data: rows } = await svc.schema('solar').from('equipment').select('id, organisation_id, kind, make, model, specs').in('id', ids)
    const usable = new Map(((rows ?? []) as Row[]).filter((r) => r.organisation_id === null || r.organisation_id === org).map((r) => [r.id as string, r]))
    const pick = (id: string | undefined, kind: string): EquipmentRow | undefined => {
      const r = id ? usable.get(id) : undefined
      return r && r.kind === kind ? (r as unknown as EquipmentRow) : undefined
    }
    if (config.pv.module) {
      const r = pick(config.pv.module.equipmentId, 'module')
      if (!r) return { fieldErrors: { 'pv.module': 'Pick the module again — it is not in your catalogue' } }
      config = { ...config, pv: { ...config.pv, module: moduleSnapshot(r) } }
    }
    if (config.pv.inverter) {
      const r = pick(config.pv.inverter.equipmentId, 'inverter')
      if (!r) return { fieldErrors: { 'pv.inverter': 'Pick the inverter again — it is not in your catalogue' } }
      config = { ...config, pv: { ...config.pv, inverter: inverterSnapshot(r) } }
    }
    if (config.battery.unit) {
      const r = pick(config.battery.unit.equipmentId, 'battery')
      if (!r) return { fieldErrors: { 'battery.unit': 'Pick the battery again — it is not in your catalogue' } }
      config = { ...config, battery: { ...config.battery, unit: batterySnapshot(r) } }
    }
  }
  if (config.weather.datasetId) {
    const { data: w } = await svc.schema('solar').from('weather_datasets').select('id').eq('id', config.weather.datasetId).eq('organisation_id', org).maybeSingle()
    if (!w) return { fieldErrors: { 'weather.datasetId': 'Fetch the weather again — that dataset is not available' } }
  }
  // A layout-linked case takes its size (and its source) from the row, never from the client:
  // Save cannot resize or unlink it — that is setSolarCasePvSourceAction's job.
  const { data: cur } = await supabase.schema('solar').from('cases').select('pv_source, config').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  const curRow = cur as { pv_source?: string; config?: unknown } | null
  if (curRow?.pv_source === 'layout') {
    const stored = parseCaseConfig(curRow.config)
    if (!stored.ok) return { error: 'The case could not be read — reload.' }
    config = { ...config, pv: { ...config.pv, source: 'layout', dcKwp: stored.config.pv.dcKwp, acKw: stored.config.pv.acKw } }
  } else if (config.pv.source === 'layout') {
    config = { ...config, pv: { ...config.pv, source: 'manual' } }
  }
  const { data, error } = await supabase.schema('solar').from('cases').update({ config, config_version: config.version })
    .eq('id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_saved', objectRef: { caseId: input.caseId } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

/**
 * Manual ↔ From layout on an existing case (spec §7.1–7.2). Linking re-derives DC/AC from the
 * layout's own objects; back to Manual keeps the last sizes as editable inputs. 00218's
 * cases_layout_fk / cases_layout_bind refuse a layout that is gone or from another project.
 */
export async function setSolarCasePvSourceAction(input: {
  projectId: string; caseId: string; expectedUpdatedAt: string; source: { kind: 'manual' } | { kind: 'layout'; layoutId: string }
}): Promise<CaseSaveResult> {
  const { supabase, userId } = await session(input.projectId)
  const { data: cur } = await supabase.schema('solar').from('cases').select('config').eq('id', input.caseId).eq('project_id', input.projectId).maybeSingle()
  const parsed = parseCaseConfig((cur as Row | null)?.config)
  if (!cur || !parsed.ok) return { error: 'Case not found.' }
  const src = input.source
  let patch: Row
  if (src?.kind === 'layout') {
    const design = typeof src.layoutId === 'string' && src.layoutId ? await loadLayoutDesign(supabase, input.projectId, src.layoutId) : null
    if (!design) return { error: 'That layout no longer exists — reload.' }
    const sized = caseSizeFromLayout(design.summary)
    if (!sized.ok) return { error: sized.error }
    const config: CaseConfig = { ...parsed.config, pv: { ...parsed.config.pv, source: 'layout', dcKwp: sized.dcKwp, acKw: sized.acKw } }
    patch = { pv_source: 'layout', layout_id: design.id, config, config_version: config.version }
  } else if (src?.kind === 'manual') {
    const config: CaseConfig = { ...parsed.config, pv: { ...parsed.config.pv, source: 'manual' } }
    patch = { pv_source: 'manual', layout_id: null, config, config_version: config.version }
  } else return { error: 'Choose Manual or From layout.' }
  const { data, error } = await supabase.schema('solar').from('cases').update(patch)
    .eq('id', input.caseId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: humanSolarError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  if (userId) await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'case_saved', objectRef: { caseId: input.caseId, pvSource: patch.pv_source, layoutId: patch.layout_id } })
  done(input.projectId)
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

export interface WeatherDatasetView { id: string; fetchedAt: string; radiationDb: string | null; latRound: number; lngRound: number; gsaPvoutKwhPerKwp: number | null; cached: boolean }

export async function fetchSolarWeatherAction(input: { projectId: string }): Promise<{ ok: true; dataset: WeatherDatasetView } | { error: string }> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study || study.latitude === null || study.longitude === null || study.latitude === undefined || study.longitude === undefined) {
    return { error: 'Set the site coordinates on Site & Supply first.' }
  }
  const r = await getOrFetchWeather({ svc: createServiceClient() as never, orgId: study.organisation_id as string, lat: Number(study.latitude), lng: Number(study.longitude), userId })
  if (!r.ok) return { error: r.error }
  const d = r.dataset
  if (!r.cached) {
    await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'weather_fetched', objectRef: { datasetId: d.id } })
    await emitProductEvent({ actorId: userId, projectId: input.projectId, event: 'solar_weather_fetched' })
  }
  return { ok: true, dataset: {
    id: d.id, fetchedAt: String(d.fetched_at ?? ''), radiationDb: (d.radiation_db ?? null) as string | null,
    latRound: Number(d.lat_round), lngRound: Number(d.lng_round),
    gsaPvoutKwhPerKwp: d.gsa_pvout_kwh_per_kwp === null || d.gsa_pvout_kwh_per_kwp === undefined ? null : Number(d.gsa_pvout_kwh_per_kwp),
    cached: r.cached,
  } }
}
