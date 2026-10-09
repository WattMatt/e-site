import { describe, it, expect } from 'vitest'
import { statusPlanWriteError } from './write-errors'

const cases: Array<[string, string, 'plan' | 'shape', RegExp]> = [
  ['23505', 'duplicate key value violates unique constraint "status_plans_drawing_page_purpose_key"', 'plan', /already has a plan for that purpose/],
  ['23505', 'duplicate key value violates unique constraint "status_plan_shapes_plan_node_key"', 'shape', /already on this plan/],
  ['23514', 'status_plans: that drawing belongs to another project', 'plan', /belongs to another project/],
  ['23514', 'status_plans: the drawing, page and purpose of a plan are fixed; create a new plan instead', 'plan', /cannot change/],
  ['23514', "status_plans: a plan can only be re-anchored to its drawing's current file", 'plan', /current file/],
  ['23514', 'status_plan_shapes: a shape cannot move to another plan', 'shape', /cannot move/],
  ['23514', 'status_plan_shapes: area types belong on tenant layout plans only', 'shape', /tenant layout plans only/],
  ['23514', 'status_plan_shapes: that board is not on this project', 'shape', /not on this project/],
  ['23514', 'status_plan_shapes: that board has been deleted', 'shape', /has been deleted/],
  ['23514', 'status_plan_shapes: a tenant layout links tenant boards only', 'shape', /tenant boards only/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_points_shape"', 'shape', /outline is not valid/],
  ['23514', 'new row for relation "status_plans" violates check constraint "status_plans_name_not_blank"', 'plan', /Give the plan a name/],
  ['23514', 'new row for relation "status_plan_shapes" violates check constraint "status_plan_shapes_link_or_area"', 'shape', /either a shop or an area/],
  ['23503', 'status_plans: drawing 6c1b… not found', 'plan', /drawing no longer exists/],
  ['23503', 'status_plan_shapes: status plan 6c1b… not found', 'shape', /plan no longer exists/],
  ['23503', 'insert or update on table "status_plan_shapes" violates foreign key constraint "status_plan_shapes_node_id_fkey"', 'shape', /board no longer exists/],
  ['42501', 'new row violates row-level security policy for table "status_plan_shapes"', 'shape', /owner, admin or project manager/],
]

describe('statusPlanWriteError', () => {
  for (const [code, message, target, expected] of cases) {
    it(`${code} ${message.slice(0, 60)}`, () => {
      expect(statusPlanWriteError({ code, message }, target)).toMatch(expected)
    })
  }

  it('never leaks a raw message, even for an unknown error', () => {
    const s = statusPlanWriteError({ code: 'XX000', message: 'internal: relation tenants.secret_thing' }, 'shape')
    expect(s).not.toMatch(/secret_thing|relation/)
    expect(s).toMatch(/shape could not be saved/)
  })

  it('falls back per code when the message is unfamiliar', () => {
    expect(statusPlanWriteError({ code: '23514', message: 'something new' }, 'plan')).toMatch(/refused/)
    expect(statusPlanWriteError({ code: '23505', message: 'something new' }, 'plan')).toMatch(/duplicate/)
    expect(statusPlanWriteError({ code: '23503', message: 'something new' }, 'plan')).toMatch(/no longer exists/)
  })

  it('handles a missing code and message', () => {
    expect(statusPlanWriteError({}, 'plan')).toMatch(/plan could not be saved/)
  })
})
