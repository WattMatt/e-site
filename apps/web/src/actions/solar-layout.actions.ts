'use server'
/**
 * Layouts (functional spec §6.2) and the save (§6.3 "Save"). Each action
 * re-checks Edit itself and writes through the caller's session. The save
 * goes through public.solar_save_layout_objects (00211): one transaction,
 * refused when updated_at moved (another tab / person), scale and anchor
 * stamped by the database. The summary stored with it is computed HERE from
 * the resulting object list — never taken from the browser.
 */
import { revalidatePath } from 'next/cache'
import { randomUUID } from 'node:crypto'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { STALE_MESSAGE } from '@/lib/solar/errors'
import { humanLayoutError } from '@/lib/solar/layout-errors'
import { parseStoredObjects, scaleForSource, type StoredObjectRow } from '@/lib/solar/layout-loader'
import {
  applyObjectDelta, cloneLayoutObjects, layoutSummary, moduleSpecError, storedSummary, validateObjectInput,
  type LayoutModuleSpec, type LayoutObject,
} from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
const MAX_UPSERTS = 1000

export type LayoutResult<T extends object = object> = ({ ok: true } & T) | { error: string } | { fieldErrors: Record<string, string> }

async function session(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}

async function studyId(supabase: AnyClient, projectId: string): Promise<string | null> {
  const { data } = await supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle()
  return (data as { id?: string } | null)?.id ?? null
}

async function nameTaken(supabase: AnyClient, sid: string, name: string, exceptId: string | null): Promise<boolean> {
  const { data } = await supabase.schema('solar').from('layouts').select('id, name').eq('study_id', sid)
  const key = name.trim().toLowerCase()
  return ((data ?? []) as Array<{ id: string; name: string }>).some((l) => l.id !== exceptId && l.name.trim().toLowerCase() === key)
}

const toRow = (o: LayoutObject) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props })

async function sheetScale(supabase: AnyClient, roofSourceId: string): Promise<number | null> {
  const { data: rs } = await supabase.schema('solar').from('roof_sources').select('kind, floor_plan_id, page_index, m_per_px').eq('id', roofSourceId).maybeSingle()
  const r = rs as { kind: string; floor_plan_id: string | null; page_index: number; m_per_px: number | null } | null
  if (!r) return null
  if (r.kind === 'satellite' || !r.floor_plan_id) return scaleForSource(r, new Map(), new Map())
  const [{ data: plan }, { data: pages }] = await Promise.all([
    supabase.schema('tenants').from('floor_plans').select('id, pixels_per_meter').eq('id', r.floor_plan_id).maybeSingle(),
    supabase.schema('tenants').from('floor_plan_page_scales').select('page_index, pixels_per_meter').eq('floor_plan_id', r.floor_plan_id),
  ])
  const p = plan as { pixels_per_meter: number | string | null } | null
  return scaleForSource(r,
    new Map([[r.floor_plan_id, p?.pixels_per_meter == null ? null : Number(p.pixels_per_meter)]]),
    new Map(((pages ?? []) as Array<{ page_index: number; pixels_per_meter: number | string }>).map((x) => [`${r.floor_plan_id}#${x.page_index}`, Number(x.pixels_per_meter)])))
}

export async function createLayoutAction(input: {
  projectId: string; name: string; roofSourceId: string; module: LayoutModuleSpec; defaultTiltDeg: number
}): Promise<LayoutResult<{ id: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  const fieldErrors: Record<string, string> = {}
  if (name.length < 1 || name.length > 120) fieldErrors.name = 'Give the layout a name (up to 120 characters).'
  const me = moduleSpecError(input.module)
  if (me) fieldErrors.module = me
  if (!(typeof input.defaultTiltDeg === 'number' && input.defaultTiltDeg >= 0 && input.defaultTiltDeg <= 60)) fieldErrors.defaultTiltDeg = 'Tilt must be between 0° and 60°.'
  if (!UUID.test(String(input.roofSourceId))) fieldErrors.roofSourceId = 'Choose a roof source.'
  if (Object.keys(fieldErrors).length) return { fieldErrors }
  const sid = await studyId(supabase, input.projectId)
  if (!sid) return { error: 'Save the site location in Site & Supply first.' }
  if (await nameTaken(supabase, sid, name, null)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data, error } = await supabase.schema('solar').from('layouts')
    .insert({ study_id: sid, roof_source_id: input.roofSourceId, name, module_spec: input.module, default_tilt_deg: input.defaultTiltDeg })
    .select('id')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A layout with that name already exists.' } } : { error: humanLayoutError(error) }
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (!id) return { error: 'Nothing was created — reload and try again.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_created', objectRef: { layoutId: id } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id }
}

export async function renameLayoutAction(input: { projectId: string; layoutId: string; name: string; expectedUpdatedAt: string }):
  Promise<LayoutResult<{ updatedAt: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 1 || name.length > 120) return { fieldErrors: { name: 'Give the layout a name (up to 120 characters).' } }
  const sid = await studyId(supabase, input.projectId)
  if (sid && await nameTaken(supabase, sid, name, input.layoutId)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data, error } = await supabase.schema('solar').from('layouts').update({ name })
    .eq('id', input.layoutId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return error.code === '23505' ? { fieldErrors: { name: 'A layout with that name already exists.' } } : { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_renamed', objectRef: { layoutId: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]!.updated_at as string }
}

/**
 * "Refused if a case uses the layout" (§6.2) is enforced by the DATABASE: the
 * cases migration (Yield & Scenarios phase) must declare cases.layout_id
 * REFERENCES solar.layouts(id) with NO ACTION, and humanLayoutError maps that
 * 23503 to "Used by a case — change the case first."
 */
export async function deleteLayoutAction(input: { projectId: string; layoutId: string }): Promise<LayoutResult> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const { data, error } = await supabase.schema('solar').from('layouts').delete()
    .eq('id', input.layoutId).eq('project_id', input.projectId).select('id')
  if (error) return { error: humanLayoutError(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: 'Nothing was deleted — reload to see the current list.' }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_deleted', objectRef: { layoutId: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true }
}

/** What saveCore needs about the layout — passed in, so Duplicate can save into a row it just created. */
interface SaveContext { layoutId: string; roofSourceId: string; tMinC: number; tAmbMaxC: number }

async function saveCore(
  supabase: AnyClient, ctx: SaveContext, expectedUpdatedAt: string, upserts: LayoutObject[], deletes: string[],
): Promise<{ updatedAt: string } | { error: string }> {
  const { data: current } = await supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', ctx.layoutId)
  // Malformed rows (a direct PostgREST write) are skipped, not allowed to break every later save.
  const saved = parseStoredObjects((current ?? []) as StoredObjectRow[])
  const final = applyObjectDelta(saved, upserts, deletes, await sheetScale(supabase, ctx.roofSourceId))
  const summary = storedSummary(layoutSummary(final, { tMinC: ctx.tMinC, tAmbMaxC: ctx.tAmbMaxC }))
  const { data, error } = await supabase.rpc('solar_save_layout_objects', {
    p_layout_id: ctx.layoutId,
    p_expected_updated_at: expectedUpdatedAt,
    p_upserts: upserts.map(toRow),
    p_deletes: deletes,
    p_summary: summary,
  })
  if (error) return { error: humanLayoutError(error) }
  return { updatedAt: String(data) }
}

export async function saveLayoutObjectsAction(input: {
  projectId: string; layoutId: string; expectedUpdatedAt: string; upserts: unknown[]; deletes: unknown[]
}): Promise<LayoutResult<{ updatedAt: string; pixelsPerMeter: Record<string, number | null> }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!Array.isArray(input.upserts) || !Array.isArray(input.deletes)) return { error: 'The layout could not be read — reload.' }
  if (input.upserts.length > MAX_UPSERTS) return { error: `Save at most ${MAX_UPSERTS} changed objects at a time.` }
  for (const o of input.upserts) {
    const e = validateObjectInput(o)
    if (e) return { error: e }
  }
  if (!input.deletes.every((d) => typeof d === 'string' && UUID.test(d))) return { error: 'The layout could not be read — reload.' }
  const upserts = input.upserts as LayoutObject[]
  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('roof_source_id, design_t_min_c, design_t_amb_max_c').eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const l = layout as { roof_source_id: string; design_t_min_c: number | string; design_t_amb_max_c: number | string } | null
  if (!l) return { error: 'This layout no longer exists — reload.' }
  const res = await saveCore(supabase,
    { layoutId: input.layoutId, roofSourceId: l.roof_source_id, tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c) },
    String(input.expectedUpdatedAt), upserts, input.deletes as string[])
  if ('error' in res) return res
  const ids = upserts.map((o) => o.id)
  const { data: stamped } = ids.length
    ? await supabase.schema('solar').from('layout_objects').select('id, pixels_per_meter').in('id', ids)
    : { data: [] }
  const pixelsPerMeter = Object.fromEntries(((stamped ?? []) as Array<{ id: string; pixels_per_meter: number | string | null }>)
    .map((r) => [r.id, r.pixels_per_meter == null ? null : Number(r.pixels_per_meter)]))
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_saved', objectRef: { layoutId: input.layoutId, upserts: upserts.length, deletes: input.deletes.length } })
  revalidatePath(`/projects/${input.projectId}/solar/layout`)
  return { ok: true, updatedAt: res.updatedAt, pixelsPerMeter }
}

/**
 * Duplicate (§6.2): a new layout on the same roof source with every object
 * copied under fresh ids. Objects are re-stamped with the sheet's CURRENT scale
 * (00211 never trusts a scale from a caller); if the page was recalibrated since
 * the original was drawn, the copy measures against the new scale.
 */
export async function duplicateLayoutAction(input: { projectId: string; layoutId: string; name: string }): Promise<LayoutResult<{ id: string }>> {
  const { supabase, userId } = await session(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = typeof input.name === 'string' ? input.name.trim() : ''
  if (name.length < 1 || name.length > 120) return { fieldErrors: { name: 'Give the layout a name (up to 120 characters).' } }
  const { data: src } = await supabase.schema('solar').from('layouts')
    .select('study_id, roof_source_id, module_spec, default_tilt_deg, design_t_min_c, design_t_amb_max_c')
    .eq('id', input.layoutId).eq('project_id', input.projectId).maybeSingle()
  const s = src as Record<string, unknown> | null
  if (!s) return { error: 'This layout no longer exists — reload.' }
  if (await nameTaken(supabase, String(s.study_id), name, null)) return { fieldErrors: { name: 'A layout with that name already exists.' } }
  const { data: created, error } = await supabase.schema('solar').from('layouts').insert({
    study_id: s.study_id, roof_source_id: s.roof_source_id, name, module_spec: s.module_spec,
    default_tilt_deg: s.default_tilt_deg, design_t_min_c: s.design_t_min_c, design_t_amb_max_c: s.design_t_amb_max_c,
  }).select('id, updated_at')
  if (error) return { error: humanLayoutError(error) }
  const row = Array.isArray(created) ? (created[0] as { id: string; updated_at: string } | undefined) : undefined
  if (!row) return { error: 'Nothing was created — reload and try again.' }
  const { data: objs } = await supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', input.layoutId)
  const copies = cloneLayoutObjects(parseStoredObjects((objs ?? []) as StoredObjectRow[])
    .map((o) => ({ ...o, pixelsPerMeter: null }) as LayoutObject), randomUUID)
  if (copies.length > 0) {
    const res = await saveCore(supabase,
      { layoutId: row.id, roofSourceId: String(s.roof_source_id), tMinC: Number(s.design_t_min_c), tAmbMaxC: Number(s.design_t_amb_max_c) },
      row.updated_at, copies, [])
    if ('error' in res) {
      await supabase.schema('solar').from('layouts').delete().eq('id', row.id)
      return res
    }
  }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'layout_duplicated', objectRef: { layoutId: row.id, from: input.layoutId } })
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, id: row.id }
}
