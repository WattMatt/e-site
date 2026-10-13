/**
 * For the tenant schedule: where each shop sits on the project's tenant floor
 * plan, so a row can link straight to its shape (?sheet=&shape=). A board
 * appears at most once per plan (00245 unique key), so each shop has at most one.
 *
 * Best-effort by design: any read error answers {} and the schedule renders
 * without links. The schedule must never fail because of a plan.
 */
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OnPlanLink {
  sheetId: string
  sheetLabel: string
  shapeId: string
}

export function pickOnPlanLinks(
  sheets: ReadonlyArray<{ id: string; label: string; sort_order: number }>,
  shapes: ReadonlyArray<{ id: string; sheet_id: string; node_id: string | null }>,
): Record<string, OnPlanLink> {
  const ordered = [...sheets].sort((a, b) => a.sort_order - b.sort_order)
  const out: Record<string, OnPlanLink> = {}
  for (const sheet of ordered) {
    for (const s of shapes) {
      if (s.sheet_id !== sheet.id || !s.node_id || out[s.node_id]) continue
      out[s.node_id] = { sheetId: sheet.id, sheetLabel: sheet.label, shapeId: s.id }
    }
  }
  return out
}

export async function loadOnPlanLinks(client: unknown, projectId: string): Promise<Record<string, OnPlanLink>> {
  try {
    const db = client as any
    const planRes = await db.schema('tenants').from('status_plans')
      .select('id').eq('project_id', projectId).eq('purpose', 'tenant_layout').maybeSingle()
    if (planRes.error || !planRes.data) return {}
    const planId = planRes.data.id as string
    const sheetsRes = await db.schema('tenants').from('status_plan_sheets')
      .select('id, label, sort_order').eq('status_plan_id', planId)
    if (sheetsRes.error) return {}
    const shapes = await readAll<{ id: string; sheet_id: string; node_id: string | null }>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, sheet_id, node_id')
        .eq('status_plan_id', planId).not('node_id', 'is', null).order('id').range(from, to))
    if ('error' in shapes) return {}
    return pickOnPlanLinks(sheetsRes.data ?? [], shapes.data)
  } catch {
    return {}
  }
}
