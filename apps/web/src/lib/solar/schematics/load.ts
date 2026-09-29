// apps/web/src/lib/solar/schematics/load.ts
import 'server-only'
/** Loaders for the Schematics list and editor (caller's client; RLS decides). JSON out. */
import type { SupabaseClient } from '@supabase/supabase-js'
import { tenantLabel } from '@/lib/solar/load/gather'
import { lineKey, type SchematicDoc } from './editor'
import type { DrawingOption, EditorMeter, EditorView, SchematicsListView } from './view-types'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>
const SCHEMATIC_COLUMNS = 'id, study_id, name, description, kind, floor_plan_id, page_index, file_path, canvas_w, canvas_h, updated_at'
const isPdf = (p: string) => /\.pdf$/i.test(p)
const renderable = (p: string) => isPdf(p) || /\.(png|jpe?g|webp|svg)$/i.test(p)

async function drawings(supabase: AnyClient, projectId: string): Promise<DrawingOption[]> {
  const { data } = await supabase.schema('tenants').from('floor_plans').select('id, name, file_path').eq('project_id', projectId).eq('is_active', true).order('name')
  return ((data ?? []) as Array<{ id: string; name: string | null; file_path: string | null }>)
    .filter((p) => renderable(String(p.file_path ?? '')))
    .map((p) => ({ id: p.id, name: p.name ?? 'Drawing', isPdf: isPdf(String(p.file_path)) }))
}

export async function loadSchematicsList(supabase: AnyClient, projectId: string): Promise<SchematicsListView> {
  const { data: study } = await supabase.schema('solar').from('studies').select('id, schematic_waived, updated_at').eq('project_id', projectId).maybeSingle()
  const s = study as { id: string; schematic_waived: boolean; updated_at: string } | null
  const d = await drawings(supabase, projectId)
  if (!s) return { studyId: null, studyUpdatedAt: null, waived: false, studyMeterCount: 0, schematics: [], drawings: d }
  const [{ data: rows }, { data: links }] = await Promise.all([
    supabase.schema('solar').from('schematics').select(SCHEMATIC_COLUMNS).eq('study_id', s.id).order('name'),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', s.id),
  ])
  const list = (rows ?? []) as Array<{ id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; floor_plan_id: string | null; page_index: number; updated_at: string }>
  const ids = list.map((r) => r.id)
  const { data: cards } = ids.length ? await supabase.schema('solar').from('schematic_cards').select('schematic_id, meter_id').in('schematic_id', ids) : { data: [] }
  const placed = new Map<string, number>()
  for (const c of (cards ?? []) as Array<{ schematic_id: string }>) placed.set(c.schematic_id, (placed.get(c.schematic_id) ?? 0) + 1)
  const planName = new Map(d.map((x) => [x.id, x.name]))
  return {
    studyId: s.id, studyUpdatedAt: s.updated_at, waived: s.schematic_waived,
    studyMeterCount: ((links ?? []) as unknown[]).length,
    schematics: list.map((r) => ({
      id: r.id, name: r.name, description: r.description, kind: r.kind, drawingName: r.floor_plan_id ? planName.get(r.floor_plan_id) ?? 'Drawing (retired)' : null,
      pageIndex: r.page_index, placed: placed.get(r.id) ?? 0, updatedAt: r.updated_at,
    })).sort((a, b) => a.name.localeCompare(b.name)),
    drawings: d,
  }
}

export async function loadSchematicEditor(supabase: AnyClient, projectId: string, schematicId: string): Promise<EditorView | null> {
  const { data: row } = await supabase.schema('solar').from('schematics').select(`${SCHEMATIC_COLUMNS}, project_id`).eq('id', schematicId).eq('project_id', projectId).maybeSingle()
  const sc = row as { id: string; study_id: string; name: string; description: string | null; kind: 'drawing' | 'blank'; floor_plan_id: string | null; page_index: number; file_path: string | null; canvas_w: number; canvas_h: number; updated_at: string } | null
  if (!sc) return null
  const [{ data: cards }, { data: lines }, { data: links }, { data: basis }, d] = await Promise.all([
    supabase.schema('solar').from('schematic_cards').select('meter_id, x, y, w, h, colour').eq('schematic_id', sc.id),
    supabase.schema('solar').from('schematic_lines').select('id, schematic_id, from_meter_id, to_meter_id, waypoints, line_type').eq('project_id', projectId),
    supabase.schema('solar').from('study_meters').select('meter_id').eq('study_id', sc.study_id),
    supabase.schema('solar').from('tenant_load_basis').select('node_id, source, meters').eq('study_id', sc.study_id),
    drawings(supabase, projectId),
  ])
  const meterIds = ((links ?? []) as Array<{ meter_id: string }>).map((l) => l.meter_id)
  const { data: meterRows } = meterIds.length ? await supabase.schema('solar').from('meters').select('id, label, kind, node_id').in('id', meterIds) : { data: [] }
  const ms = (meterRows ?? []) as Array<{ id: string; label: string; kind: string; node_id: string | null }>
  const nodeIds = [...new Set(ms.map((m) => m.node_id).filter((x): x is string => Boolean(x)))]
  const { data: nodes } = nodeIds.length ? await supabase.schema('structure').from('nodes').select('id, shop_number, shop_name, name, code').in('id', nodeIds) : { data: [] }
  const nodeLabel = new Map(((nodes ?? []) as Array<{ id: string; shop_number: string | null; shop_name: string | null; name: string | null; code: string | null }>).map((n) => [n.id, tenantLabel(n)]))
  const basisByNode = new Map(((basis ?? []) as Array<{ node_id: string; source: string; meters: Array<{ meter_id: string }> }>).map((b) => [b.node_id, b]))
  const meters: EditorMeter[] = ms.map((m) => {
    const b = m.node_id ? basisByNode.get(m.node_id) : undefined
    const included = !b ? null : b.source === 'excluded' ? false : b.source === 'metered' ? b.meters.some((x) => x.meter_id === m.id) : null
    return { id: m.id, label: m.label, kind: m.kind, nodeId: m.node_id, tenantLabel: m.node_id ? nodeLabel.get(m.node_id) ?? null : null, included }
  }).sort((a, b) => a.label.localeCompare(b.label))
  const all = (lines ?? []) as Array<{ schematic_id: string; from_meter_id: string; to_meter_id: string; waypoints: number[]; line_type: 'supply' | 'check' }>
  const doc: SchematicDoc = {
    cards: ((cards ?? []) as Array<{ meter_id: string; x: number; y: number; w: number; h: number; colour: string | null }>).map((c) => ({
      meterId: c.meter_id, x: Number(c.x), y: Number(c.y), w: Number(c.w), h: Number(c.h), colour: c.colour,
    })),
    lines: all.filter((l) => l.schematic_id === sc.id).map((l) => ({
      key: lineKey({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type }),
      fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, waypoints: (l.waypoints ?? []).map(Number), lineType: l.line_type,
    })),
  }
  let sheet: EditorView['sheet'] = null
  let anchorChanged = false
  if (sc.kind === 'drawing' && sc.floor_plan_id) {
    const { data: plan } = await supabase.schema('tenants').from('floor_plans').select('id, name, file_path, width_px, height_px').eq('id', sc.floor_plan_id).maybeSingle()
    const p = plan as { id: string; name: string | null; file_path: string | null; width_px: number | null; height_px: number | null } | null
    if (p) {
      const path = String(p.file_path ?? '')
      const { data: signed } = renderable(path) ? await supabase.storage.from('drawings').createSignedUrl(path, 3600) : { data: null }
      sheet = { planId: p.id, name: p.name ?? 'Drawing', signedUrl: (signed as { signedUrl?: string } | null)?.signedUrl ?? null, isPdf: isPdf(path), widthPx: p.width_px, heightPx: p.height_px }
      anchorChanged = p.file_path !== sc.file_path
    }
  }
  return {
    schematic: { id: sc.id, name: sc.name, description: sc.description, kind: sc.kind, pageIndex: sc.page_index, updatedAt: sc.updated_at, canvasW: sc.canvas_w, canvasH: sc.canvas_h, anchorChanged, floorPlanId: sc.floor_plan_id },
    sheet,
    doc,
    meters,
    externalLines: all.filter((l) => l.schematic_id !== sc.id).map((l) => ({ fromMeterId: l.from_meter_id, toMeterId: l.to_meter_id, lineType: l.line_type })),
    drawings: d,
  }
}
