/**
 * A Postgres / PostgREST refusal on a tenant plan write, as a sentence.
 *
 * Codes come from 00245 and 00248: 23514 for trigger and CHECK refusals, 23505
 * for the unique keys, 23503 for a missing project / plan / sheet / board, and
 * 42501 from RLS. Each rule needs the code AND a distinctive substring, so two
 * different refusals with one code never share a sentence. The raw message is
 * never returned: it names constraints and tables, which mean nothing to the
 * person drawing and leak schema to anyone else.
 */
export type WriteTarget = 'plan' | 'sheet' | 'shape'

export interface PgErrorLike {
  code?: string | null
  message?: string | null
}

const RULES: ReadonlyArray<{ code: string; match?: RegExp; sentence: string }> = [
  { code: '23505', match: /status_plans_project_purpose_key/, sentence: 'This project already has that plan. Reload the page.' },
  { code: '23505', match: /status_plan_shapes_plan_node_key/, sentence: 'That board is already on this plan. Select its shape instead of linking it twice.' },
  { code: '23505', match: /status_plan_sheets_plan_order_key/, sentence: 'Two sheets cannot share a position. Reload and try again.' },
  { code: '23505', match: /status_plan_sheets_pkey/, sentence: 'That upload was already registered. Reload the page.' },
  { code: '23514', match: /project and purpose of a plan are fixed/, sentence: "A plan's project and purpose cannot change." },
  { code: '23514', match: /a sheet cannot move to another plan/, sentence: 'A sheet cannot move to another plan.' },
  { code: '23514', match: /must be stored under this plan/, sentence: 'That file does not belong to this plan. Upload it again.' },
  { code: '23514', match: /file type does not match/, sentence: 'The file type does not match the file. Upload it again.' },
  { code: '23514', match: /an image has one page/, sentence: 'An image has one page.' },
  { code: '23514', match: /status_plan_sheets_label_not_blank/, sentence: 'Give the sheet a name (up to 120 characters).' },
  { code: '23514', match: /status_plan_sheets_calibration_shape/, sentence: 'The scale needs two points and a distance. Set it again.' },
  { code: '23514', match: /a shape cannot move to another plan/, sentence: 'A shape cannot move to another plan.' },
  { code: '23514', match: /a shape cannot move to another sheet/, sentence: 'A shape cannot move to another sheet.' },
  { code: '23514', match: /that sheet belongs to another plan/, sentence: 'That sheet belongs to another plan. Reload the page.' },
  { code: '23514', match: /area types belong on tenant layout/, sentence: 'Area types are for the floor plan only.' },
  { code: '23514', match: /not on this project/, sentence: 'That board is not on this project.' },
  { code: '23514', match: /has been deleted/, sentence: 'That board has been deleted. Pick another, or leave the shape unassigned.' },
  { code: '23514', match: /tenant boards only/, sentence: 'The floor plan links tenant boards only.' },
  { code: '23514', match: /status_plan_shapes_points_shape/, sentence: "That shape's outline is not valid: it needs at least 3 corners, and a rectangle exactly 4." },
  { code: '23514', match: /status_plans_name_not_blank/, sentence: 'Give the plan a name.' },
  { code: '23514', match: /status_plan_shapes_link_or_area/, sentence: 'A shape is either a shop or an area, not both.' },
  { code: '23503', match: /project .* not found/, sentence: 'That project no longer exists, or you cannot see it.' },
  { code: '23503', match: /status plan .* not found|status_plan_id_fkey/, sentence: 'That plan no longer exists. Reload the page.' },
  { code: '23503', match: /sheet .* not found|sheet_id_fkey/, sentence: 'That sheet no longer exists. Reload the page.' },
  { code: '23503', match: /node_id_fkey/, sentence: 'That board no longer exists. Pick another.' },
  { code: '42501', sentence: 'Only an owner, admin or project manager can change tenant plans on this project.' },
]

const BY_CODE: Record<string, string> = {
  '23514': 'The database refused that change. Reload and check the plan.',
  '23505': 'That would duplicate something already on this plan.',
  '23503': 'Something this refers to no longer exists. Reload and try again.',
}

const FALLBACK: Record<WriteTarget, string> = {
  plan: 'The plan could not be saved. Reload and try again.',
  sheet: 'The sheet could not be saved. Reload and try again.',
  shape: 'The shape could not be saved. Reload and try again.',
}

export function statusPlanWriteError(err: PgErrorLike, target: WriteTarget): string {
  const code = err.code ?? ''
  const message = err.message ?? ''
  for (const r of RULES) {
    if (r.code === code && (!r.match || r.match.test(message))) return r.sentence
  }
  return BY_CODE[code] ?? FALLBACK[target]
}
