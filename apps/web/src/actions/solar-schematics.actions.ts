'use server'
/**
 * Schematics tab writes (functional spec §13). Each action re-checks Solar Edit and writes with the
 * caller's session, so 00215's RESTRICTIVE solar_can_edit policies and bind triggers decide (drawing on
 * this project and active, meter in this study, no loop). The report upload alone uses the service
 * client, after the gate, as every other sheet export does.
 */
import { revalidatePath } from 'next/cache'
import type { SupabaseClient } from '@supabase/supabase-js'
import { createClient, createServiceClient } from '@/lib/supabase/server'
import { requireSolarLevel } from '@/lib/solar/access'
import { recordSolarAudit } from '@/lib/solar/audit'
import { GENERIC_ERROR, STALE_MESSAGE } from '@/lib/solar/errors'
import { METER_KIND_OPTIONS, type MeterKind } from '@/lib/solar/load/view-types'
import { renderSchematicSheetPdf } from '@/lib/solar/schematics/sheet-pdf'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
type Err = { error: string }
const COLOUR_RE = /^#[0-9a-fA-F]{6}$/
const listPath = (p: string) => `/projects/${p}/solar/schematics`

async function ctx(projectId: string) {
  const supabase = (await createClient()) as unknown as AnyClient
  await requireSolarLevel(projectId, 'edit', supabase)
  const { data: { user } } = await supabase.auth.getUser()
  return { supabase, userId: user?.id ?? null }
}
async function studyOf(supabase: AnyClient, projectId: string) {
  const { data } = await supabase.schema('solar').from('studies').select('id, updated_at').eq('project_id', projectId).maybeSingle()
  return (data as { id: string; updated_at: string } | null) ?? null
}
async function ensureStudy(supabase: AnyClient, projectId: string) {
  const s = await studyOf(supabase, projectId)
  if (s) return s
  const { data } = await supabase.schema('solar').from('studies').insert({ project_id: projectId }).select('id, updated_at')
  return (Array.isArray(data) ? (data[0] as { id: string; updated_at: string } | undefined) : undefined) ?? (await studyOf(supabase, projectId))
}
function human(err: { code?: string; message?: string } | null): string {
  const m = (err?.message ?? '').toLowerCase()
  if (err?.code === '40001' || m.includes('stale')) return STALE_MESSAGE
  if (m.includes('loop')) return 'That connection would make a loop in the supply hierarchy.'
  if (m.includes('only a meter of this study')) return 'Only meters of this study can be placed.'
  if (m.includes('both meters must be placed')) return 'Both meters must be placed on this schematic.'
  if (m.includes('drawing belongs to another project')) return 'That drawing belongs to another project.'
  if (m.includes('no longer active')) return 'That drawing is no longer active — choose its current version.'
  if (err?.code === '23505') return m.includes('pair') ? 'Those meters are connected twice.' : 'A schematic with that name already exists.'
  if (err?.code === '42501') return 'You do not have permission to do that.'
  return GENERIC_ERROR
}

export type SchematicSource = { kind: 'drawing'; floorPlanId: string; pageIndex: number } | { kind: 'blank' }

export async function createSchematicAction(input: { projectId: string; name: string; description: string | null; source: SchematicSource }): Promise<{ ok: true; id: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (name.length === 0 || name.length > 120) return { error: 'Give the schematic a name.' }
  const description = input.description == null ? null : String(input.description).slice(0, 2000)
  const src = input.source
  if (src?.kind === 'drawing' && !(typeof src.floorPlanId === 'string' && Number.isInteger(src.pageIndex) && src.pageIndex >= 1)) return { error: 'Choose a drawing and a page.' }
  const study = await ensureStudy(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const row = src?.kind === 'drawing'
    ? { study_id: study.id, name, description, kind: 'drawing', floor_plan_id: src.floorPlanId, page_index: src.pageIndex }
    : { study_id: study.id, name, description, kind: 'blank' }
  const { data, error } = await supabase.schema('solar').from('schematics').insert(row).select('id')
  const id = Array.isArray(data) ? (data[0]?.id as string | undefined) : undefined
  if (error || !id) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_created', objectRef: { schematicId: id } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, id }
}

export async function updateSchematicMetaAction(input: { projectId: string; schematicId: string; name: string; description: string | null; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const name = String(input.name ?? '').trim()
  if (name.length === 0 || name.length > 120) return { error: 'Give the schematic a name.' }
  const { data, error } = await supabase.schema('solar').from('schematics').update({ name, description: input.description == null ? null : String(input.description).slice(0, 2000) })
    .eq('id', input.schematicId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(listPath(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function replaceSchematicDrawingAction(input: { projectId: string; schematicId: string; floorPlanId: string; pageIndex: number; expectedUpdatedAt: string }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (!(Number.isInteger(input.pageIndex) && input.pageIndex >= 1)) return { error: 'Choose a page.' }
  const { data, error } = await supabase.schema('solar').from('schematics').update({ floor_plan_id: input.floorPlanId, page_index: input.pageIndex })
    .eq('id', input.schematicId).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  if (error) return { error: human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_drawing_replaced', objectRef: { schematicId: input.schematicId, floorPlanId: input.floorPlanId, pageIndex: input.pageIndex } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export async function deleteSchematicsAction(input: { projectId: string; ids: string[] }): Promise<{ ok: true; deleted: number } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const ids = [...new Set((input.ids ?? []).filter((x) => typeof x === 'string'))].slice(0, 200)
  if (ids.length === 0) return { error: 'Choose at least one schematic.' }
  const { data, error } = await supabase.schema('solar').from('schematics').delete().in('id', ids).eq('project_id', input.projectId).select('id')
  if (error) return { error: human(error) }
  const n = Array.isArray(data) ? data.length : 0
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematics_deleted', objectRef: { count: n } })
  revalidatePath(listPath(input.projectId))
  return { ok: true, deleted: n }
}

export async function setSchematicWaivedAction(input: { projectId: string; waived: boolean; expectedUpdatedAt: string | null }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const q = input.expectedUpdatedAt === null
    ? supabase.schema('solar').from('studies').insert({ project_id: input.projectId, schematic_waived: Boolean(input.waived) }).select('updated_at')
    : supabase.schema('solar').from('studies').update({ schematic_waived: Boolean(input.waived) }).eq('project_id', input.projectId).eq('updated_at', input.expectedUpdatedAt).select('updated_at')
  const { data, error } = await q
  if (error) return { error: error.code === '23505' ? STALE_MESSAGE : human(error) }
  if (!Array.isArray(data) || data.length === 0) return { error: STALE_MESSAGE }
  revalidatePath(`/projects/${input.projectId}/solar`, 'layout')
  return { ok: true, updatedAt: data[0]?.updated_at as string }
}

export interface SaveCard { meterId: string; x: number; y: number; w: number; h: number; colour: string | null }
export interface SaveLine { fromMeterId: string; toMeterId: string; waypoints: number[]; lineType: 'supply' | 'check' }

export async function saveSchematicAction(input: { projectId: string; schematicId: string; expectedUpdatedAt: string; cards: SaveCard[]; lines: SaveLine[] }): Promise<{ ok: true; updatedAt: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const cards = Array.isArray(input.cards) ? input.cards : []
  const lines = Array.isArray(input.lines) ? input.lines : []
  if (cards.length > 500 || lines.length > 1000) return { error: 'A schematic holds at most 500 meters and 1,000 connections.' }
  const fin = (v: unknown) => typeof v === 'number' && Number.isFinite(v)
  if (cards.some((c) => typeof c.meterId !== 'string' || ![c.x, c.y, c.w, c.h].every(fin) || c.w <= 0 || c.h <= 0 || (c.colour !== null && !COLOUR_RE.test(String(c.colour))))) {
    return { error: 'A card has an invalid position or size.' }
  }
  if (lines.some((l) => typeof l.fromMeterId !== 'string' || typeof l.toMeterId !== 'string' || !Array.isArray(l.waypoints) || l.waypoints.length % 2 !== 0 || l.waypoints.length > 400 || !l.waypoints.every(fin) || !['supply', 'check'].includes(l.lineType))) {
    return { error: 'A connection has an invalid route.' }
  }
  const { data: sc } = await supabase.schema('solar').from('schematics').select('id').eq('id', input.schematicId).eq('project_id', input.projectId).maybeSingle()
  if (!sc) return { error: 'This schematic no longer exists — reload.' }
  const { data, error } = await supabase.rpc('solar_save_schematic', {
    p_schematic_id: input.schematicId, p_expected_updated_at: input.expectedUpdatedAt, p_cards: cards, p_lines: lines,
  })
  if (error) return { error: human(error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_saved', objectRef: { schematicId: input.schematicId, cards: cards.length, lines: lines.length } })
  return { ok: true, updatedAt: String(data) }
}

export async function createMeterStubAction(input: { projectId: string; label: string; kind: MeterKind }): Promise<{ ok: true; meter: { id: string; label: string; kind: string } } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const label = String(input.label ?? '').trim()
  if (label.length === 0 || label.length > 200) return { error: 'Name the meter.' }
  if (!METER_KIND_OPTIONS.some((k) => k.value === input.kind) || input.kind === 'water') return { error: 'Choose a meter kind.' }
  const { data: project } = await supabase.schema('projects').from('projects').select('organisation_id').eq('id', input.projectId).maybeSingle()
  const orgId = (project as { organisation_id?: string } | null)?.organisation_id
  const study = await ensureStudy(supabase, input.projectId)
  if (!orgId || !study) return { error: GENERIC_ERROR }
  const { data, error } = await supabase.schema('solar').from('meters').insert({ organisation_id: orgId, label, kind: input.kind, serials: [] }).select('id, label, kind')
  const m = Array.isArray(data) ? (data[0] as { id: string; label: string; kind: string } | undefined) : undefined
  if (error || !m) return { error: human(error) }
  const link = await supabase.schema('solar').from('study_meters').upsert({ study_id: study.id, meter_id: m.id }, { onConflict: 'study_id,meter_id', ignoreDuplicates: true })
  if (link.error) return { error: human(link.error) }
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'meter_stub_created', objectRef: { meterId: m.id } })
  return { ok: true, meter: m }
}

/**
 * Include / exclude a meter's tenant in the site load. The tenant row is read-modify-written ON THE
 * VERSION READ (a concurrent Tenants-tab edit is refused, not overwritten; a racing first insert is
 * refused too). Returns the include state of EVERY meter of that tenant in this study, because
 * excluding one meter excludes the tenant — sibling cards on the canvas must follow.
 */
export async function setIncludeInLoadAction(input: { projectId: string; meterId: string; include: boolean }): Promise<{ ok: true; nodeId: string; included: Record<string, boolean | null> } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  const study = await studyOf(supabase, input.projectId)
  if (!study) return { error: GENERIC_ERROR }
  const { data: link } = await supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', study.id).eq('meter_id', input.meterId).maybeSingle()
  if (!link) return { error: 'That meter is not in this study.' }
  const { data: meter } = await supabase.schema('solar').from('meters').select('node_id').eq('id', input.meterId).maybeSingle()
  const nodeId = (meter as { node_id?: string | null } | null)?.node_id
  if (!nodeId) return { error: 'Link this meter to a tenant first (Load → Meters → Details).' }
  const t = () => supabase.schema('solar').from('tenant_load_basis')
  const { data: row } = await t().select('id, source, meters, updated_at').eq('study_id', study.id).eq('node_id', nodeId).maybeSingle()
  const b = row as { id: string; source: string; meters: Array<{ meter_id: string; weight: number }>; updated_at: string } | null
  const source = input.include ? 'metered' : 'excluded'
  const meters = input.include
    ? (b ? (b.meters.some((m) => m.meter_id === input.meterId) ? b.meters : [...b.meters, { meter_id: input.meterId, weight: 1 }]) : [{ meter_id: input.meterId, weight: 1 }])
    : (b ? b.meters : [])
  const res = b
    ? await t().update(input.include ? { source, meters } : { source }).eq('id', b.id).eq('updated_at', b.updated_at).select('id')
    : await t().insert({ study_id: study.id, node_id: nodeId, source, meters }).select('id')
  if (res.error) return { error: res.error.code === '23505' ? STALE_MESSAGE : human(res.error) }
  if (!Array.isArray(res.data) || res.data.length === 0) return { error: STALE_MESSAGE }

  // Every meter of this tenant that is in this study, with its state after the write.
  const [{ data: siblings }, { data: links }] = await Promise.all([
    supabase.schema('solar').from('meters').select('id').eq('node_id', nodeId),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', study.id),
  ])
  const inStudy = new Set(((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id))
  const included: Record<string, boolean | null> = {}
  for (const s of (siblings ?? []) as Array<{ id: string }>) {
    if (!inStudy.has(s.id)) continue
    included[s.id] = source === 'excluded' ? false : meters.some((m) => m.meter_id === s.id)
  }
  included[input.meterId] = input.include
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: input.include ? 'meter_included_in_load' : 'meter_excluded_from_load', objectRef: { meterId: input.meterId, nodeId } })
  revalidatePath(`/projects/${input.projectId}/solar/load`)
  return { ok: true, nodeId, included }
}

const MAX_CROP_PX = 20_000
/**
 * `basedOn` is the schematic updated_at the client's canvas was loaded / last saved on. A sheet is
 * issued only for the row the server holds now: if the row moved on (someone else saved, or the
 * client is stale) the export is refused rather than filing a sheet whose drawing and legend
 * disagree with the saved schematic.
 */
export async function exportSchematicSheetAction(input: { projectId: string; schematicId: string; basedOn: string; jpegBase64: string; crop: { w: number; h: number }; note: string | null }): Promise<{ ok: true; version: number; reportId: string } | Err> {
  const { supabase, userId } = await ctx(input.projectId)
  if (!userId) return { error: 'You are not signed in.' }
  if (typeof input.jpegBase64 !== 'string' || input.jpegBase64.length < 100 || input.jpegBase64.length > 9_500_000) return { error: 'The sheet image could not be read — try again.' }
  const c = input.crop
  if (!c || ![c.w, c.h].every((v) => typeof v === 'number' && Number.isFinite(v) && v > 0 && v <= MAX_CROP_PX)) return { error: 'The sheet image could not be read — try again.' }
  const { data: scRow } = await supabase.schema('solar').from('schematics').select('id, study_id, organisation_id, name, kind, floor_plan_id, page_index, updated_at').eq('id', input.schematicId).eq('project_id', input.projectId).maybeSingle()
  const sc = scRow as { id: string; study_id: string; organisation_id: string; name: string; kind: string; floor_plan_id: string | null; page_index: number; updated_at: string } | null
  if (!sc) return { error: 'This schematic no longer exists — reload.' }
  if (typeof input.basedOn !== 'string' || input.basedOn !== sc.updated_at) {
    return { error: 'This schematic was changed since you opened it — reload, then export.' }
  }
  const [{ data: cards }, { data: lines }, { data: project }, { data: plan }] = await Promise.all([
    supabase.schema('solar').from('schematic_cards').select('meter_id').eq('schematic_id', sc.id),
    supabase.schema('solar').from('schematic_lines').select('from_meter_id').eq('schematic_id', sc.id),
    supabase.schema('projects').from('projects').select('name').eq('id', input.projectId).maybeSingle(),
    sc.floor_plan_id ? supabase.schema('tenants').from('floor_plans').select('name').eq('id', sc.floor_plan_id).maybeSingle() : Promise.resolve({ data: null }),
  ])
  const meterIds = ((cards ?? []) as Array<{ meter_id: string }>).map((x) => x.meter_id)
  const { data: meters } = meterIds.length ? await supabase.schema('solar').from('meters').select('id, label, kind, node_id').in('id', meterIds) : { data: [] }
  const nodeIds = [...new Set(((meters ?? []) as Array<{ node_id: string | null }>).map((m) => m.node_id).filter((x): x is string => Boolean(x)))]
  const [{ data: nodes }, { data: basis }] = await Promise.all([
    nodeIds.length ? supabase.schema('structure').from('nodes').select('id, shop_number, shop_name, name, code').in('id', nodeIds) : Promise.resolve({ data: [] }),
    supabase.schema('solar').from('tenant_load_basis').select('node_id, source, meters').eq('study_id', sc.study_id),
  ])
  const nodeName = new Map(((nodes ?? []) as Array<{ id: string; shop_number: string | null; shop_name: string | null; name: string | null; code: string | null }>)
    .map((n) => [n.id, `${n.shop_number ? `${n.shop_number} ` : ''}${n.shop_name ?? n.name ?? n.code ?? ''}`.trim()]))
  const basisBy = new Map(((basis ?? []) as Array<{ node_id: string; source: string; meters: Array<{ meter_id: string }> }>).map((b) => [b.node_id, b]))
  const legend = ((meters ?? []) as Array<{ id: string; label: string; kind: string; node_id: string | null }>).map((m) => {
    const b = m.node_id ? basisBy.get(m.node_id) : undefined
    return {
      label: m.label, kind: m.kind, tenant: m.node_id ? nodeName.get(m.node_id) ?? null : null,
      included: !b ? null : b.source === 'excluded' ? false : b.source === 'metered' ? b.meters.some((x) => x.meter_id === m.id) : null,
    }
  })

  const service = createServiceClient() as unknown as AnyClient
  const { data: prior } = await service.schema('projects').from('reports').select('id, version')
    .eq('project_id', input.projectId).eq('kind', 'solar_schematic_sheet').eq('source_id', sc.id).eq('status', 'issued')
    .order('version', { ascending: false }).limit(1).maybeSingle()
  const version = prior ? Number((prior as { version: number }).version) + 1 : 1
  let pdf: Uint8Array
  try {
    pdf = await renderSchematicSheetPdf({
      jpegBase64: input.jpegBase64, imageWidthPx: c.w, imageHeightPx: c.h,
      projectName: (project as { name?: string } | null)?.name ?? '', schematicName: sc.name,
      sourceLabel: sc.kind === 'drawing' ? `${(plan as { name?: string } | null)?.name ?? 'Drawing'} - page ${sc.page_index}` : 'Blank canvas',
      version, dateIso: new Date().toISOString().slice(0, 10), legend, connections: ((lines ?? []) as unknown[]).length, warnings: [],
    })
  } catch {
    return { error: 'The sheet image could not be read — try again.' }
  }
  const storagePath = `${sc.organisation_id}/${input.projectId}/solar-schematic-sheets/${sc.id}-v${version}.pdf`
  const { error: upErr } = await service.storage.from('reports').upload(storagePath, pdf, { contentType: 'application/pdf', upsert: false })
  if (upErr) return { error: 'Could not store the sheet — try again.' }
  // The kind is a LITERAL on purpose: report-kind-access.contract.test.ts finds writers by scanning for it.
  const { data: rep, error: insErr } = await service.schema('projects').from('reports').insert({
    organisation_id: sc.organisation_id,
    project_id: input.projectId,
    kind: 'solar_schematic_sheet',
    source_table: 'solar.schematics',
    source_id: sc.id,
    title: `Metering schematic — ${sc.name}`,
    storage_path: storagePath,
    mime_type: 'application/pdf',
    size_bytes: pdf.length,
    status: 'issued',
    version,
    summary: { meters: meterIds.length, connections: ((lines ?? []) as unknown[]).length },
    note: input.note == null ? null : String(input.note).slice(0, 2000),
    generated_by: userId,
  }).select('id')
  const reportId = Array.isArray(rep) ? (rep[0]?.id as string | undefined) : undefined
  if (insErr || !reportId) {
    await service.storage.from('reports').remove([storagePath])
    return { error: 'Could not save the sheet — try again.' }
  }
  if (prior) await service.schema('projects').from('reports').update({ status: 'superseded', superseded_by: reportId }).eq('id', (prior as { id: string }).id)
  await recordSolarAudit({ projectId: input.projectId, actorId: userId, verb: 'schematic_sheet_exported', objectRef: { schematicId: sc.id, version } })
  revalidatePath(`${listPath(input.projectId)}/${sc.id}`)
  return { ok: true, version, reportId }
}
