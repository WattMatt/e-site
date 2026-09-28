import 'server-only'
/**
 * Loaders for the Layout tab. Everything returned is JSON: a page hands it to a
 * 'use client' component, and a function prop across that boundary compiles
 * and fails at render (the PR #201 lesson). Reads go through the CALLER's
 * session so 00211's solar_can_view decides; only solar.org_settings (owner/
 * admin RLS, not secret) is read with the service client.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { readSolarOrgSettings, type LayoutModuleSpec, type LayoutObject } from '@esite/shared'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
export type SignUrl = (bucket: string, path: string) => Promise<string | null>

export interface RoofSourceRow {
  id: string
  kind: 'drawing' | 'satellite'
  floorPlanId: string | null
  pageIndex: number
  label: string
  pixelsPerMeter: number | null
  northBearingDeg: number | null
  northSet: boolean
  drawingChanged: boolean
  attribution: string | null
  updatedAt: string
}

type SourceDb = {
  id: string; kind: 'drawing' | 'satellite'; floor_plan_id: string | null; page_index: number; file_path: string | null
  north_bearing_deg: number | string | null; storage_path: string | null; m_per_px: number | string | null
  attribution: string | null; updated_at: string
}
const SOURCE_COLS = 'id, kind, floor_plan_id, page_index, file_path, north_bearing_deg, storage_path, m_per_px, attribution, updated_at'
const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null)

/** The scale 00211's layout_objects_bind would stamp: page scale, else page 1 → drawing, satellite → 1 / m per px. */
export function scaleForSource(
  s: { kind: string; page_index: number; floor_plan_id: string | null; m_per_px: number | string | null },
  drawingScale: Map<string, number | null>,
  pageScale: Map<string, number>,
): number | null {
  if (s.kind === 'satellite') {
    const m = num(s.m_per_px)
    return m && m > 0 ? 1 / m : null
  }
  if (!s.floor_plan_id) return null
  const page = pageScale.get(`${s.floor_plan_id}#${s.page_index}`)
  if (page) return page
  return s.page_index === 1 ? (drawingScale.get(s.floor_plan_id) ?? null) : null
}

async function sourcesWithScales(supabase: AnyClient, rows: SourceDb[]) {
  const fpIds = [...new Set(rows.map((r) => r.floor_plan_id).filter((x): x is string => !!x))]
  const [{ data: plans }, { data: pages }] = await Promise.all([
    fpIds.length ? supabase.schema('tenants').from('floor_plans').select('id, name, file_path, pixels_per_meter').in('id', fpIds) : Promise.resolve({ data: [] }),
    fpIds.length ? supabase.schema('tenants').from('floor_plan_page_scales').select('floor_plan_id, page_index, pixels_per_meter').in('floor_plan_id', fpIds) : Promise.resolve({ data: [] }),
  ])
  const planRows = (plans ?? []) as Array<{ id: string; name: string; file_path: string; pixels_per_meter: number | string | null }>
  const planById = new Map(planRows.map((p) => [p.id, p]))
  const drawingScale = new Map(planRows.map((p) => [p.id, num(p.pixels_per_meter)]))
  const pageScale = new Map(((pages ?? []) as Array<{ floor_plan_id: string; page_index: number; pixels_per_meter: number | string }>)
    .map((p) => [`${p.floor_plan_id}#${p.page_index}`, Number(p.pixels_per_meter)]))
  const out: Array<RoofSourceRow & { currentFilePath: string | null; storagePath: string | null }> = rows.map((r) => {
    const plan = r.floor_plan_id ? planById.get(r.floor_plan_id) : undefined
    const north = num(r.north_bearing_deg)
    return {
      id: r.id,
      kind: r.kind,
      floorPlanId: r.floor_plan_id,
      pageIndex: r.page_index,
      label: r.kind === 'satellite' ? 'Satellite capture' : `${plan?.name ?? 'Drawing'} · page ${r.page_index}`,
      pixelsPerMeter: scaleForSource(r, drawingScale, pageScale),
      northBearingDeg: north,
      northSet: north !== null,
      drawingChanged: r.kind === 'drawing' && !!plan && plan.file_path !== r.file_path,
      attribution: r.attribution,
      updatedAt: r.updated_at,
      currentFilePath: plan?.file_path ?? null,
      storagePath: r.storage_path,
    }
  })
  return out
}

export async function loadRoofSources(supabase: AnyClient, projectId: string): Promise<{ studyId: string | null; sources: RoofSourceRow[] }> {
  const [{ data: study }, { data: rows }] = await Promise.all([
    supabase.schema('solar').from('studies').select('id').eq('project_id', projectId).maybeSingle(),
    supabase.schema('solar').from('roof_sources').select(SOURCE_COLS).eq('project_id', projectId).order('created_at'),
  ])
  const full = await sourcesWithScales(supabase, (rows ?? []) as SourceDb[])
  return {
    studyId: (study as { id?: string } | null)?.id ?? null,
    sources: full.map(({ currentFilePath: _c, storagePath: _s, ...r }) => r),
  }
}

export interface LayoutListRow {
  id: string
  name: string
  roofSourceId: string
  dcKwp: number | null
  moduleCount: number | null
  updatedAt: string
}

export async function loadLayoutList(supabase: AnyClient, projectId: string): Promise<LayoutListRow[]> {
  const { data } = await supabase.schema('solar').from('layouts')
    .select('id, name, roof_source_id, summary, updated_at').eq('project_id', projectId).order('name')
  return ((data ?? []) as Array<{ id: string; name: string; roof_source_id: string; summary: Record<string, unknown> | null; updated_at: string }>)
    .map((l) => ({
      id: l.id, name: l.name, roofSourceId: l.roof_source_id,
      dcKwp: num(l.summary?.dcKwp), moduleCount: num(l.summary?.moduleCount), updatedAt: l.updated_at,
    }))
}

export interface LayoutEditorData {
  projectId: string
  layout: { id: string; name: string; updatedAt: string; moduleSpec: LayoutModuleSpec; defaultTiltDeg: number; tMinC: number; tAmbMaxC: number }
  source: RoofSourceRow & { sheet: { key: string; signedUrl: string | null; isPdf: boolean; pageIndex: number } }
  sheetPixelsPerMeter: number | null
  drawingChanged: boolean
  objects: LayoutObject[]
  latitude: number | null
  shadeFree: { fromHour: number; toHour: number }
  setbackDefaults: { flatM: number; pitchedM: number }
  nodes: Array<{ id: string; label: string }>
}

export async function loadLayoutEditor(
  supabase: AnyClient, service: AnyClient, projectId: string, layoutId: string, sign: SignUrl,
): Promise<LayoutEditorData | null> {
  const { data: layout } = await supabase.schema('solar').from('layouts')
    .select('id, project_id, name, roof_source_id, module_spec, default_tilt_deg, design_t_min_c, design_t_amb_max_c, updated_at')
    .eq('id', layoutId).eq('project_id', projectId).maybeSingle()
  const l = layout as {
    id: string; name: string; roof_source_id: string; module_spec: LayoutModuleSpec; default_tilt_deg: number | string
    design_t_min_c: number | string; design_t_amb_max_c: number | string; updated_at: string
  } | null
  if (!l) return null

  const [{ data: srcRows }, { data: objRows }, { data: study }, { data: nodeRows }] = await Promise.all([
    supabase.schema('solar').from('roof_sources').select(SOURCE_COLS).eq('id', l.roof_source_id),
    supabase.schema('solar').from('layout_objects').select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', l.id),
    supabase.schema('solar').from('studies').select('latitude, organisation_id').eq('project_id', projectId).maybeSingle(),
    supabase.schema('structure').from('nodes').select('id, code, name').eq('project_id', projectId).eq('status', 'active').order('code'),
  ])
  const [src] = await sourcesWithScales(supabase, (srcRows ?? []) as SourceDb[])
  if (!src) return null

  const isPdf = src.kind === 'drawing' && /\.pdf$/i.test(src.currentFilePath ?? '')
  const signedUrl = src.kind === 'satellite'
    ? (src.storagePath ? await sign('solar-roof-images', src.storagePath) : null)
    : (src.currentFilePath ? await sign('drawings', src.currentFilePath) : null)

  const orgId = (study as { organisation_id?: string } | null)?.organisation_id ?? null
  const { data: settingsRow } = orgId
    ? await service.schema('solar').from('org_settings').select('settings').eq('organisation_id', orgId).maybeSingle()
    : { data: null }
  const settings = readSolarOrgSettings((settingsRow as { settings?: unknown } | null)?.settings)
  const n = (k: string, d: number) => (typeof settings[k] === 'number' ? (settings[k] as number) : d)

  const { currentFilePath: _c, storagePath: _s, ...sourceRow } = src
  return {
    projectId,
    layout: {
      id: l.id, name: l.name, updatedAt: l.updated_at, moduleSpec: l.module_spec,
      defaultTiltDeg: Number(l.default_tilt_deg), tMinC: Number(l.design_t_min_c), tAmbMaxC: Number(l.design_t_amb_max_c),
    },
    source: { ...sourceRow, sheet: { key: src.id, signedUrl, isPdf, pageIndex: src.pageIndex } },
    sheetPixelsPerMeter: src.pixelsPerMeter,
    drawingChanged: src.drawingChanged,
    objects: ((objRows ?? []) as Array<{ id: string; kind: string; geometry: unknown; props: unknown; pixels_per_meter: number | string | null }>)
      .map((o) => ({ id: o.id, kind: o.kind, geometry: o.geometry, props: o.props, pixelsPerMeter: num(o.pixels_per_meter) }) as LayoutObject),
    latitude: num((study as { latitude?: unknown } | null)?.latitude),
    shadeFree: { fromHour: n('row_spacing_shade_free_from_hour', 9), toHour: n('row_spacing_shade_free_to_hour', 15) },
    setbackDefaults: { flatM: n('edge_setback_flat_m', 0.5), pitchedM: n('edge_setback_pitched_m', 0.3) },
    nodes: ((nodeRows ?? []) as Array<{ id: string; code: string; name: string | null }>)
      .map((x) => ({ id: x.id, label: x.name ? `${x.code} — ${x.name}` : x.code })),
  }
}
