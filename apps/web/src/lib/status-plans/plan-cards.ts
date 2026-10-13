/**
 * The tenant schedule's "Tenant plans" cards (spec 2026-10-12 §2): per tool,
 * whether a plan exists and how many sheets, shapes and linked shapes it has.
 * Read through the caller's session. Best-effort by design: any read error
 * answers the two empty cards, so the schedule never fails because of a plan.
 */
import { STATUS_PLAN_PURPOSES, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface TenantPlanCard {
  purpose: StatusPlanPurpose
  planId: string | null
  sheets: number
  shapes: number
  linked: number
}

/** Floor plan first, then line diagram (STATUS_PLAN_PURPOSES order). */
export function emptyCards(): TenantPlanCard[] {
  return STATUS_PLAN_PURPOSES.map((purpose) => ({ purpose, planId: null, sheets: 0, shapes: 0, linked: 0 }))
}

export async function loadTenantPlanCards(client: unknown, projectId: string): Promise<TenantPlanCard[]> {
  const cards = emptyCards()
  try {
    const db = client as any
    const plans = await db.schema('tenants').from('status_plans').select('id, purpose').eq('project_id', projectId)
    if (plans.error || !plans.data?.length) return cards
    const ids = (plans.data as Array<{ id: string }>).map((p) => p.id)
    const [sheets, shapes] = await Promise.all([
      db.schema('tenants').from('status_plan_sheets').select('id, status_plan_id').in('status_plan_id', ids),
      readAll<{ id: string; status_plan_id: string; node_id: string | null }>((from, to) =>
        db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id')
          .in('status_plan_id', ids).order('id').range(from, to)),
    ])
    if (sheets.error || 'error' in shapes) return emptyCards()
    for (const p of plans.data as Array<{ id: string; purpose: StatusPlanPurpose }>) {
      const card = cards.find((c) => c.purpose === p.purpose)
      if (!card) continue
      const mine = shapes.data.filter((s) => s.status_plan_id === p.id)
      card.planId = p.id
      card.sheets = (sheets.data as Array<{ status_plan_id: string }>).filter((s) => s.status_plan_id === p.id).length
      card.shapes = mine.length
      card.linked = mine.filter((s) => s.node_id).length
    }
    return cards
  } catch {
    return emptyCards()
  }
}
