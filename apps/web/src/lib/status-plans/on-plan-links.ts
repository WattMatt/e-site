/**
 * For the tenant schedule: which tenant-layout status plan shows each shop,
 * so a row can link straight to its shape (?shape=). A shop on several plans
 * links to the most recently updated one.
 *
 * Best-effort by design: any read error answers {} and the schedule renders
 * without links. The schedule must never fail because of a plan.
 */
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface OnPlanLink {
  planId: string
  planName: string
  shapeId: string
}

export function pickOnPlanLinks(
  plans: ReadonlyArray<{ id: string; name: string; updated_at: string }>,
  shapes: ReadonlyArray<{ id: string; status_plan_id: string; node_id: string | null }>,
): Record<string, OnPlanLink> {
  const newestFirst = [...plans].sort((a, b) => b.updated_at.localeCompare(a.updated_at))
  const out: Record<string, OnPlanLink> = {}
  for (const p of newestFirst) {
    for (const s of shapes) {
      if (s.status_plan_id !== p.id || !s.node_id || out[s.node_id]) continue
      out[s.node_id] = { planId: p.id, planName: p.name, shapeId: s.id }
    }
  }
  return out
}

export async function loadOnPlanLinks(client: unknown, projectId: string): Promise<Record<string, OnPlanLink>> {
  try {
    const db = client as any
    const plansRes = await db.schema('tenants').from('status_plans')
      .select('id, name, updated_at').eq('project_id', projectId).eq('purpose', 'tenant_layout')
    if (plansRes.error || !plansRes.data?.length) return {}
    const ids = (plansRes.data as Array<{ id: string }>).map((p) => p.id)
    const shapes = await readAll<{ id: string; status_plan_id: string; node_id: string | null }>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id')
        .in('status_plan_id', ids).not('node_id', 'is', null).order('id').range(from, to))
    if ('error' in shapes) return {}
    return pickOnPlanLinks(plansRes.data, shapes.data)
  } catch {
    return {}
  }
}
