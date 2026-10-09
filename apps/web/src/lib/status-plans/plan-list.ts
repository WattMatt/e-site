/**
 * The status plans list page: one row per plan with its drawing and counts,
 * and the drawings a new plan can be made on. Read through the caller's
 * session (RLS is the gate). Drawing names include retired drawings, because a
 * plan may still sit on one; the New-plan picker offers active drawings only.
 */
import { PURPOSE_LABEL, type StatusPlanPurpose } from '@esite/shared/status-plans'
import { readAll } from '@/lib/tender/read-all'
import { isRenderableDrawing } from './plan-urls'

/* eslint-disable @typescript-eslint/no-explicit-any */

export interface PlanListRow {
  id: string
  name: string
  purpose: StatusPlanPurpose
  purposeLabel: string
  pageIndex: number
  drawingName: string
  shapes: number
  linked: number
  areas: number
  updatedAt: string
}

export interface DrawingOption {
  id: string
  name: string
  /** PDF or image: the canvas can draw it. Others are listed, disabled. */
  renderable: boolean
}

type PlanRowIn = { id: string; name: string; purpose: string; page_index: number; floor_plan_id: string; updated_at: string }
type ShapeRowIn = { status_plan_id: string; node_id: string | null; area_type: string | null }

export function planListRows(
  plans: ReadonlyArray<PlanRowIn>,
  drawings: ReadonlyArray<{ id: string; name: string | null }>,
  shapes: ReadonlyArray<ShapeRowIn>,
): PlanListRow[] {
  const drawingName = new Map(drawings.map((d) => [d.id, d.name ?? 'Drawing']))
  const counts = new Map<string, { shapes: number; linked: number; areas: number }>()
  for (const s of shapes) {
    const c = counts.get(s.status_plan_id) ?? { shapes: 0, linked: 0, areas: 0 }
    c.shapes += 1
    if (s.node_id) c.linked += 1
    if (s.area_type) c.areas += 1
    counts.set(s.status_plan_id, c)
  }
  return plans.map((p) => {
    const purpose = p.purpose as StatusPlanPurpose
    const c = counts.get(p.id) ?? { shapes: 0, linked: 0, areas: 0 }
    return {
      id: p.id,
      name: p.name,
      purpose,
      purposeLabel: PURPOSE_LABEL[purpose] ?? p.purpose,
      pageIndex: Number(p.page_index),
      drawingName: drawingName.get(p.floor_plan_id) ?? 'Drawing not available',
      ...c,
      updatedAt: p.updated_at,
    }
  })
}

export function defaultPlanName(drawingName: string, purpose: StatusPlanPurpose, pageIndex: number): string {
  const suffix = ` — ${PURPOSE_LABEL[purpose]}${pageIndex > 1 ? ` (page ${pageIndex})` : ''}`
  return `${drawingName.slice(0, 120 - suffix.length)}${suffix}`
}

export async function loadStatusPlanList(client: unknown, projectId: string): Promise<{ rows: PlanListRow[]; drawings: DrawingOption[] }> {
  const db = client as any
  const [plansRes, drawingsRes] = await Promise.all([
    db.schema('tenants').from('status_plans')
      .select('id, name, purpose, page_index, floor_plan_id, updated_at')
      .eq('project_id', projectId).order('name'),
    readAll<{ id: string; name: string | null; file_path: string | null; is_active: boolean | null }>((from, to) =>
      db.schema('tenants').from('floor_plans').select('id, name, file_path, is_active')
        .eq('project_id', projectId).order('name').order('id').range(from, to)),
  ])
  if (plansRes.error) throw new Error(`status plans: ${plansRes.error.message}`)
  if ('error' in drawingsRes) throw new Error(`drawings: ${drawingsRes.error}`)
  const plans = (plansRes.data ?? []) as PlanRowIn[]

  let shapes: ShapeRowIn[] = []
  if (plans.length > 0) {
    const ids = plans.map((p) => p.id)
    const res = await readAll<ShapeRowIn>((from, to) =>
      db.schema('tenants').from('status_plan_shapes').select('id, status_plan_id, node_id, area_type')
        .in('status_plan_id', ids).order('id').range(from, to))
    if ('error' in res) throw new Error(`status plan shapes: ${res.error}`)
    shapes = res.data
  }

  return {
    rows: planListRows(plans, drawingsRes.data, shapes),
    drawings: drawingsRes.data
      .filter((d) => d.is_active !== false)
      .map((d) => ({ id: d.id, name: d.name ?? 'Drawing', renderable: isRenderableDrawing(String(d.file_path ?? '')) })),
  }
}
