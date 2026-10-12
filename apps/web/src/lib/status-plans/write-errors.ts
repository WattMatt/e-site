/**
 * A Postgres / PostgREST refusal on a status-plan write, as a sentence.
 *
 * Codes come from slice 1 (00245): 23514 for trigger and CHECK refusals, 23505
 * for the two unique keys, 23503 for a missing drawing / plan / board, and
 * 42501 from RLS. Each rule needs the code AND a distinctive substring, so two
 * different refusals with one code never share a sentence. The raw message is
 * never returned: it names constraints and tables, which mean nothing to the
 * person drawing and leak schema to anyone else.
 */
export type WriteTarget = 'plan' | 'shape'

export interface PgErrorLike {
  code?: string | null
  message?: string | null
}

const RULES: ReadonlyArray<{ code: string; match?: RegExp; sentence: string }> = [
  { code: '23505', match: /status_plans_drawing_page_purpose_key/, sentence: 'This page of the drawing already has a plan for that purpose. Open the existing plan instead.' },
  { code: '23505', match: /status_plan_shapes_plan_node_key/, sentence: 'That board is already on this plan. Select its shape instead of linking it twice.' },
  { code: '23514', match: /belongs to another project/, sentence: 'That drawing belongs to another project.' },
  { code: '23514', match: /are fixed/, sentence: "A plan's drawing, page and purpose cannot change. Create a new plan instead." },
  { code: '23514', match: /re-anchored/, sentence: "A plan can only be moved onto its drawing's current file. Reload and try again." },
  { code: '23514', match: /cannot move to another plan/, sentence: 'A shape cannot move to another plan.' },
  { code: '23514', match: /area types belong on tenant layout/, sentence: 'Area types are for tenant layout plans only.' },
  { code: '23514', match: /not on this project/, sentence: 'That board is not on this project.' },
  { code: '23514', match: /has been deleted/, sentence: 'That board has been deleted. Pick another, or leave the shape unassigned.' },
  { code: '23514', match: /tenant boards only/, sentence: 'A tenant layout links tenant boards only.' },
  { code: '23514', match: /status_plan_shapes_points_shape/, sentence: "That shape's outline is not valid: it needs at least 3 corners, and a rectangle exactly 4." },
  { code: '23514', match: /status_plans_name_not_blank/, sentence: 'Give the plan a name.' },
  { code: '23514', match: /status_plan_shapes_link_or_area/, sentence: 'A shape is either a shop or an area, not both.' },
  { code: '23503', match: /status plan .* not found|status_plan_id_fkey/, sentence: 'That plan no longer exists. Go back to the list and reload.' },
  { code: '23503', match: /drawing .* not found|floor_plan_id_fkey/, sentence: 'That drawing no longer exists, or you cannot see it.' },
  { code: '23503', match: /node_id_fkey/, sentence: 'That board no longer exists. Pick another.' },
  { code: '42501', sentence: 'Only an owner, admin or project manager can change status plans on this project.' },
]

const BY_CODE: Record<string, string> = {
  '23514': 'The database refused that change. Reload and check the plan.',
  '23505': 'That would duplicate something already on this plan.',
  '23503': 'Something this refers to no longer exists. Reload and try again.',
}

export function statusPlanWriteError(err: PgErrorLike, target: WriteTarget): string {
  const code = err.code ?? ''
  const message = err.message ?? ''
  for (const r of RULES) {
    if (r.code === code && (!r.match || r.match.test(message))) return r.sentence
  }
  return BY_CODE[code] ?? (target === 'plan'
    ? 'The plan could not be saved. Reload and try again.'
    : 'The shape could not be saved. Reload and try again.')
}
