import 'server-only'
/**
 * What a case needs from a layout (From layout, Import BOM): its summary and bill of materials,
 * computed HERE from the layout's own objects — never from solar.layouts.summary, which a direct
 * PostgREST write could set (00211). Read through the CALLER's session: RLS decides whether the
 * layout is visible, and the project filter keeps it to this project.
 */
import type { SupabaseClient } from '@supabase/supabase-js'
import { layoutBom, layoutSummary, type BomRow, type LayoutSummary } from '@esite/shared'
import { parseStoredObjects, type StoredObjectRow } from '@/lib/solar/layout-loader'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyClient = SupabaseClient<any, any, any>

export interface LayoutDesign { id: string; name: string; summary: LayoutSummary; bom: BomRow[] }

export async function loadLayoutDesign(supabase: AnyClient, projectId: string, layoutId: string): Promise<LayoutDesign | null> {
  const { data: l } = await supabase.schema('solar').from('layouts')
    .select('id, name, design_t_min_c, design_t_amb_max_c').eq('id', layoutId).eq('project_id', projectId).maybeSingle()
  const row = l as { id: string; name: string; design_t_min_c: number | string; design_t_amb_max_c: number | string } | null
  if (!row) return null
  const { data: objs } = await supabase.schema('solar').from('layout_objects')
    .select('id, kind, geometry, props, pixels_per_meter').eq('layout_id', layoutId)
  const objects = parseStoredObjects((objs ?? []) as StoredObjectRow[])
  const summary = layoutSummary(objects, { tMinC: Number(row.design_t_min_c), tAmbMaxC: Number(row.design_t_amb_max_c) })
  return { id: row.id, name: row.name, summary, bom: layoutBom(objects, summary) }
}
