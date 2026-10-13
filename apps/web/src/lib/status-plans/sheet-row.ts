/** tenants.status_plan_sheets rows ↔ what the page and the actions hand around. Client-safe (types only). */
import type { StatusPlanSheetRow } from '@esite/shared/status-plans'
import type { PlanSheet, SheetSummary } from './types'

export const SHEET_COLUMNS =
  'id, status_plan_id, organisation_id, sort_order, label, file_path, page_index, file_name, mime, revision, replaced_at, replaced_from_path, pixels_per_meter, calibration_points, calibration_metres, created_by, created_at, updated_at'

const num = (v: unknown): number | null => (v === null || v === undefined || v === '' ? null : Number(v))

export function toSheetSummary(r: StatusPlanSheetRow): SheetSummary {
  return {
    id: r.id,
    label: r.label,
    sortOrder: Number(r.sort_order),
    fileName: r.file_name,
    mime: r.mime,
    pageIndex: Number(r.page_index),
    revision: Number(r.revision),
    replacedAt: r.replaced_at ?? null,
    pixelsPerMeter: num(r.pixels_per_meter),
    updatedAt: r.updated_at,
  }
}

/** The canvas sheet without its canvas-only fields, for the strip's list. */
export function summaryOf(s: PlanSheet): SheetSummary {
  return {
    id: s.id,
    label: s.label,
    sortOrder: s.sortOrder,
    fileName: s.fileName,
    mime: s.mime,
    pageIndex: s.pageIndex,
    revision: s.revision,
    replacedAt: s.replacedAt,
    pixelsPerMeter: s.pixelsPerMeter,
    updatedAt: s.updatedAt,
  }
}
