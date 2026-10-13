import { describe, it, expect } from 'vitest'
import { statusPlanWriteError, type WriteTarget } from './write-errors'

const cases: Array<[string, string, WriteTarget, RegExp]> = [
  ['23505', 'duplicate key value violates unique constraint "status_plans_project_purpose_key"', 'plan', /already has that plan/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"', 'shape', /already on this plan/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_sheets_plan_order_key"', 'sheet', /share a position/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_sheets_pkey"', 'sheet', /already registered/],
  ['23514', 'status_plans: the project and purpose of a plan are fixed', 'plan', /cannot change/],
  ['23514', 'status_plan_sheets: a sheet cannot move to another plan', 'sheet', /sheet cannot move/],
  ['23514', 'status_plan_sheets: the file must be stored under this plan', 'sheet', /does not belong to this plan/],
  ['23514', 'status_plan_sheets: the file type does not match its name', 'sheet', /file type does not match/],
  ['23514', 'status_plan_sheets: an image has one page', 'sheet', /image has one page/],
  ['23514', 'new row for relation "status_plan_sheets" violates check constraint "status_plan_sheets_label_not_blank"', 'sheet', /Give the sheet a name/],
  ['23514', 'new row for relation "status_plan_sheets" violates check constraint "status_plan_sheets_calibration_shape"', 'sheet', /two points and a distance/],
  ['23514', 'status_plan_shapes: a shape cannot move to another plan', 'shape', /shape cannot move to another plan/],
  ['23514', 'status_plan_shapes: a shape cannot move to another sheet', 'shape', /another sheet/],
  ['23514', 'status_plan_shapes: that sheet belongs to another plan', 'shape', /sheet belongs to another plan/],
  ['23514', 'status_plan_shapes: area types belong on tenant layout plans only', 'shape', /floor plan only/],
  ['23514', 'status_plan_shapes: that board is not on this project', 'shape', /not on this project/],
  ['23514', 'status_plan_shapes: that board has been deleted', 'shape', /has been deleted/],
  ['23514', 'status_plan_shapes: a tenant layout links tenant boards only', 'shape', /tenant boards only/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_points_shape"', 'shape', /outline is not valid/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_link_or_area"', 'shape', /either a shop or an area/],
  ['23503', 'status_plans: project 6c1b… not found', 'plan', /project no longer exists/],
  ['23503', 'status_plan_sheets: status plan 6c1b… not found', 'sheet', /plan no longer exists/],
  ['23503', 'status_plan_shapes: sheet 6c1b… not found', 'shape', /sheet no longer exists/],
  ['23503', 'insert or update on table "status_plan_shapes" violates foreign key constraint "status_plan_shapes_node_id_fkey"', 'shape', /board no longer exists/],
  ['42501', 'new row violates row-level security policy for table "status_plan_sheets"', 'sheet', /owner, admin or project manager/],
]

describe('statusPlanWriteError', () => {
  it.each(cases)('%s %s → a sentence', (code, message, target, sentence) => {
    expect(statusPlanWriteError({ code, message }, target)).toMatch(sentence)
  })

  it('never returns the raw message', () => {
    for (const [code, message, target] of cases) expect(statusPlanWriteError({ code, message }, target)).not.toContain(message)
  })

  it('falls back by code, then by target', () => {
    expect(statusPlanWriteError({ code: '23514', message: 'something new' }, 'sheet')).toBe('The database refused that change. Reload and check the plan.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'sheet')).toBe('The sheet could not be saved. Reload and try again.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'plan')).toBe('The plan could not be saved. Reload and try again.')
    expect(statusPlanWriteError({ code: 'XX000', message: 'boom' }, 'shape')).toBe('The shape could not be saved. Reload and try again.')
  })
})
